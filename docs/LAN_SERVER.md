# Servidor en red local

Guía para que un equipo de la tienda sea el servidor de base-shop y del backoffice, y que todos los equipos de la tienda lo abran por la red, con HTTPS (T-331, ADR-0171). No es el despliegue en la nube, que sigue pendiente (T-330).

## Cómo queda

```
Equipos de la tienda ──HTTPS──► Caddy (puertos 80 y 443 del servidor)
                                  ├── /v1 y /media ──► API (imagen production)
                                  └── todo lo demás ──► backoffice compilado
API ──► PostgreSQL (sin publicar)    Respaldo diario ──► carpeta BACKUP_DIR
```

- **Un solo origen:** el backoffice y la API se abren en `https://<SERVER_ADDRESS>`; no hace falta CORS entre ellos.
- **HTTPS local:** Caddy emite el certificado con su propia autoridad (`tls internal`). Cada equipo instala una vez el certificado raíz; dura 10 años y Caddy renueva solo los certificados del servidor.
- **Dos usuarios de base de datos:** la migración usa el dueño del esquema (`POSTGRES_USER`); la API, `APP_DB_USER`, que solo lee y escribe datos (`DATABASE.md` §13).
- **IP real de cada equipo:** la API cree el `X-Forwarded-For` de Caddy (`TRUST_PROXY_HOPS=1`), así que los límites de peticiones y la auditoría ven el equipo que hizo cada petición, no a Caddy.
- **Correos:** sin proveedor (P-24), quedan en Mailpit, que solo se abre en el servidor: `http://localhost:8025`.

## Requisitos del servidor

- Un equipo que se quede encendido en horario de la tienda, con un no-break.
- Docker Desktop (Windows o macOS) o Docker Engine con Compose (Linux), con la opción de iniciar al encender el equipo.
- Git, y las carpetas de `base-shop` y `base-ecomm-admin` una junto a la otra.
- **IP fija** en la red de la tienda: se reserva en el router (reserva DHCP) para la tarjeta de red del servidor.
- El firewall del servidor permite la entrada a los puertos 80 y 443 en la red privada.

## Primera instalación

1. Clonar los dos repositorios en la misma carpeta:

   ```bash
   git clone https://github.com/Ferchoner/base-shop
   git clone https://github.com/Ferchoner/base-ecomm-admin
   cd base-shop
   ```

2. Copiar `.env.server.example` a `.env.server` y llenarlo:
   - `SERVER_ADDRESS`: la IP fija del servidor, por ejemplo `192.168.1.50`;
   - las dos contraseñas de la base y `JWT_SECRET` (al menos 32 caracteres), largas y aleatorias, por ejemplo con `openssl rand -base64 33`;
   - los datos de la tienda para el ticket y el superadministrador.

   `.env.server` tiene contraseñas: se queda solo en el servidor y Git lo ignora.

3. Levantar todo:

   ```bash
   docker compose -f docker-compose.server.yml --env-file .env.server up -d --build
   ```

   La primera vez construye las imágenes y crea la base: tarda varios minutos. La migración corre antes de la API; el respaldo, después de la migración.

4. Crear el primer superadministrador (una sola vez); muestra su contraseña temporal:

   ```bash
   docker compose -f docker-compose.server.yml --env-file .env.server exec api node dist/scripts/create-first-superadmin.js
   ```

5. Sacar el certificado raíz de Caddy:

   ```bash
   docker compose -f docker-compose.server.yml --env-file .env.server cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
   ```

6. Instalar `caddy-root.crt` en **cada equipo** de la tienda, incluido el servidor:
   - **Windows:** doble clic en el archivo, "Instalar certificado", "Equipo local", "Colocar todos los certificados en el siguiente almacén", "Entidades de certificación raíz de confianza". Reiniciar el navegador.
   - **macOS:** abrirlo con Acceso a Llaveros, en el llavero Sistema, y en "Confiar" elegir "Confiar siempre".
   - **Android:** Ajustes, Seguridad, Cifrado y credenciales, Instalar un certificado, Certificado de CA.

   Firefox usa su propio almacén: en Ajustes, Privacidad y seguridad, Certificados, Ver certificados, Autoridades, Importar.

7. Abrir `https://<SERVER_ADDRESS>` en cada equipo, entrar con el superadministrador y crear las cuentas del staff y los almacenes (uno por local).

## Operación diaria

- **Arranque:** con `restart: unless-stopped`, los servicios vuelven solos cuando Docker inicia. Basta con que Docker arranque al encender el equipo.
- **Estado:** `docker compose -f docker-compose.server.yml --env-file .env.server ps`. Todos deben estar `Up`; `migrate` termina con `Exited (0)`.
- **Si el servidor no responde:** las dos tiendas anotan las ventas y los traslados en papel, como en el plan de migración, y se capturan cuando vuelva.

## Respaldos

- El servicio `backup` hace un `pg_dump` al arrancar y uno diario a las `BACKUP_HOUR` (hora de la Ciudad de México) en `BACKUP_DIR`, con nombres como `base-shop-2026-11-07_2300.dump`. Borra los de más de `BACKUP_KEEP_DAYS` días.
- Conviene que `BACKUP_DIR` esté en otro disco o en una carpeta sincronizada con la nube: si el disco del servidor falla, el respaldo en el mismo disco se pierde con él.
- Los respaldos tienen datos personales de clientes: la carpeta no se comparte.
- **Respaldo manual**, por ejemplo antes de actualizar:

  ```bash
  docker compose -f docker-compose.server.yml --env-file .env.server exec backup pg_dump --format=custom --file=/backups/base-shop-manual.dump
  ```

### Restaurar un respaldo

Reemplaza todos los datos por los del respaldo. Se detiene la API para que nadie escriba durante la restauración:

```bash
docker compose -f docker-compose.server.yml --env-file .env.server stop api
docker compose -f docker-compose.server.yml --env-file .env.server exec backup sh -c 'pg_restore --clean --if-exists --dbname="$PGDATABASE" /backups/base-shop-2026-11-07_2300.dump'
docker compose -f docker-compose.server.yml --env-file .env.server start api
```

Las imágenes de los productos y el archivo de la auditoría viven en el volumen `api-storage`, que el respaldo de la base no incluye.

## Actualizar a una versión nueva

1. Hacer un respaldo manual.
2. Traer la versión de los dos repositorios: `git pull` en `base-shop` y en `base-ecomm-admin`.
3. Reconstruir y levantar: el mismo comando de la instalación. La migración corre sola antes de la API.

   ```bash
   docker compose -f docker-compose.server.yml --env-file .env.server up -d --build
   ```

4. Revisar que todo esté `Up` y entrar al backoffice.

## Problemas comunes

| Qué pasa | Qué revisar |
| --- | --- |
| El navegador dice que la conexión no es privada | Falta el certificado raíz en ese equipo (paso 6), o se abrió otra dirección que `SERVER_ADDRESS` |
| Un equipo no abre la página y el servidor sí | El firewall del servidor (puertos 80 y 443) o que el equipo esté en la misma red |
| Dejó de abrir después de cambiar de router | La IP del servidor cambió: reservarla de nuevo, o cambiar `SERVER_ADDRESS` y reconstruir (`up -d --build`), lo que también pide instalar de nuevo el certificado si cambió la dirección |
| `api` se reinicia una y otra vez | `docker compose ... logs api`: una variable que falta o es inválida aparece por nombre |
| `migrate` termina con error | `docker compose ... logs migrate`; no se levanta la API con una migración a medias |
