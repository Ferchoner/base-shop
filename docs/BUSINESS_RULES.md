# BUSINESS RULES

Cada regla indica su fuente. Lo no definido se marca como PENDIENTE DE DEFINICIÓN con su decisión pendiente (P-xx, ver `PROGRESS.md`). Los casos de uso que aplican cada regla están en `REQUIREMENTS.md`.

## Usuarios y acceso

- BR-USR-01. El email es único (restricción `UNIQUE` en base de datos como garantía final). Se compara normalizado.
- BR-USR-02. Un usuario suspendido no puede autenticarse.
- BR-USR-03. No se puede quitar el último rol con permisos de superadministrador.
- BR-USR-04. Un rol solo puede contener permisos del catálogo definido en código (ADR-0017).
- BR-USR-05. Un cliente registrado necesita email verificado para colocar una orden; sin verificar puede iniciar sesión y usar el carrito (ADR-0044). Las compras como invitado no requieren verificación; el invitado es responsable del email que usa.
- BR-USR-06. El staff se suspende, nunca se borra. Un cliente que pide eliminar su cuenta se anonimiza; sus órdenes se conservan (ADR-0038).
- BR-USR-07. Un rol solo se borra si no tiene usuarios asignados.
- BR-USR-08. Cada cuenta es de tipo cliente o staff. Las cuentas de staff no compran y los clientes nunca tienen roles (ADR-0043).
- BR-USR-09. Las cuentas de staff solo las crea un superadministrador, con contraseña temporal que se cambia obligatoriamente en el primer inicio de sesión.
- BR-USR-10. Las contraseñas de todas las cuentas cumplen la política de ADR-0047.
- BR-USR-11. El enlace de verificación de email es de un solo uso y vence a las 24 horas; cambiar el email obliga a verificarlo de nuevo (ADR-0046).
- BR-USR-12. La respuesta a una solicitud de reenvío de verificación no revela si el email existe (ADR-0046).
- BR-USR-13. Las contraseñas temporales del staff las genera el sistema con al menos 15 caracteres (ADR-0047).
- BR-USR-14. Una cuenta suspendida se reactiva con una acción explícita, con motivo y auditada, por el mismo permiso que la suspende. El staff reactivado recibe una contraseña temporal nueva con cambio obligatorio y conserva sus roles; el cliente reactivado conserva su contraseña. Una cuenta anonimizada no se reactiva (ADR-0076).
- BR-USR-15. El registro de cliente pide email, contraseña, nombres y apellidos; el teléfono se pide en cada dirección (ADR-0057).
- BR-USR-16. La contraseña se recupera con un enlace enviado al email, de un solo uso y vigente 30 minutos; la respuesta no revela si el email existe; las cuentas suspendidas no reciben el correo; restablecer revoca todas las sesiones y envía un aviso (ADR-0056).
- BR-USR-17. El cambio obligatorio de contraseña del staff pide la contraseña temporal (ADR-0056).
- BR-USR-18. El login responde "credenciales no válidas" sin distinguir email inexistente, contraseña incorrecta o cuenta suspendida. El registro sí indica que un email ya está registrado; el registro tiene rate limiting (ADR-0062).
- BR-USR-19. Cambiar la contraseña desde la cuenta revoca las demás sesiones del usuario, conserva la actual y envía un aviso por correo (ADR-0072).

## Productos

- BR-PRD-01. El SKU es único a nivel global.
- BR-PRD-02. No puede haber dos variantes activas de un producto con la misma combinación de opciones; las descontinuadas no cuentan (ADR-0076).
- BR-PRD-03. Mover una categoría no puede crear ciclos en el árbol.
- BR-PRD-04. Solo se publica un producto con al menos una variante activa.
- BR-PRD-05. Publicar no exige precio vigente ni imagen (ADR-0016).
- BR-PRD-06. La tienda oculta variantes sin precio vigente, y el producto completo si ninguna tiene precio.
- BR-PRD-07. Productos y variantes referenciados por órdenes nunca se borran físicamente; se archivan o descontinúan.
- BR-PRD-08. Las imágenes de producto aceptan JPEG, PNG y WebP, con un máximo de 5 MB por imagen (configurable).
- BR-PRD-09. Un SKU nunca se reutiliza, aunque su variante esté descontinuada. El slug de un producto archivado sigue reservado (ADR-0038).
- BR-PRD-10. Una categoría o marca solo se borra si no tiene productos ni subcategorías; si no, se desactiva.
- BR-PRD-11. Una variante es vendible si su producto está publicado, la variante está activa y tiene precio vigente en la lista predeterminada (deriva de BR-PRD-06 y ADR-0016). El carrito y el checkout rechazan variantes no vendibles.
- BR-PRD-12. SKU y opciones de una variante solo se editan mientras su producto nunca se ha publicado; el SKU anterior se libera en ese caso. Después quedan fijos, y no se agregan dimensiones de opciones a un producto publicado. Peso, dimensiones y estado se editan siempre (ADR-0068).
- BR-PRD-13. Un producto archivado se reactiva a DRAFT y se publica con el flujo normal; una variante descontinuada se reactiva solo si ninguna variante activa del producto tiene su combinación de opciones; una categoría se reactiva solo si su padre está activa o es raíz, sin reactivar subcategorías; una marca se reactiva sin condiciones. Todas con `catalog.write` (ADR-0076).
- BR-PRD-14. Peso (gramos) y dimensiones (centímetros) de una variante son opcionales (ADR-0058).
- BR-PRD-15. En el catálogo público, el precio de un producto para filtrar y ordenar es el más bajo entre sus variantes vendibles, con IVA incluido (ADR-0060).
- BR-PRD-16. El slug de una categoría o marca se puede cambiar; el anterior deja de funcionar y queda libre. Riesgo aceptado: los enlaces que usaban el slug anterior se rompen (ADR-0072).

## Precios

- BR-PRC-01. No hay periodos de precio superpuestos para la misma variante en la misma lista.
- BR-PRC-02. La moneda del precio coincide con la de su lista.
- BR-PRC-03. El monto es mayor o igual a cero. El precio de comparación, si existe, es mayor que el monto.
- BR-PRC-04. Los periodos pasados son inmutables. Un periodo iniciado no se cancela; se cierra.
- BR-PRC-05. Cambiar un precio cierra el periodo vigente y abre uno nuevo; programar es crear un periodo futuro.
- BR-PRC-06. En el MVP existe una sola lista general, marcada como predeterminada y no desactivable (ADR-0039).
- BR-PRC-07. Si una lista más específica no tiene precio para una variante, se usa el de la predeterminada.
- BR-PRC-08. La prioridad es única entre listas activas; nunca se elige automáticamente el precio más bajo.
- BR-PRC-09. Todos los precios están en MXN (ADR-0026, ADR-0039).
- BR-PRC-10. BR-PRC-07 y BR-PRC-08 aplican cuando existan listas adicionales; en el MVP solo existe la predeterminada.
- BR-PRC-11. La base de datos impide periodos de precio superpuestos para la misma variante y lista mediante una restricción de exclusión, además de la validación del dominio (ADR-0066).

## Inventario

- BR-INV-01. En todo momento, 0 ≤ reserved ≤ onHand. Disponible = onHand − reserved.
- BR-INV-02. Una reserva es todo o nada.
- BR-INV-03. Transiciones de reserva: Active → Committed | Released | Expired.
- BR-INV-04. Hay a lo sumo una reserva activa por referencia.
- BR-INV-05. Todo ajuste de stock requiere motivo y genera un movimiento.
- BR-INV-06. `onHand` disminuye al confirmarse el pago (ADR-0011).
- BR-INV-07. La reserva tiene un TTL fijo configurable; valor inicial de 20 minutos.
- BR-INV-08. Opera un solo almacén en el MVP.
- BR-INV-09. Cancelar una orden en PendingPayment libera su reserva (DOMAIN_MODEL, flujo Ordering → Inventory).
- BR-INV-10. El reintegro de stock de una orden cancelada o con envío devuelto es independiente: una entrada con motivo y referencia a la orden, total o parcial. Además, como opción, el staff con `inventory.write` puede reintegrar todas las líneas completas al cancelar una orden en Paid, o al registrar o reintentar su reembolso si la orden no tiene ningún reintegro previo. La suma reintegrada por línea no supera lo vendido (ADR-0052).
- BR-INV-11. Ajustes y reintegros llevan un motivo obligatorio de una lista cerrada y una nota opcional (obligatoria con "Otro"); las entradas solo llevan nota opcional. Los motivos Dañado, Pérdida o robo y Uso interno solo restan stock; los reintegros solo suman (ADR-0069).
- BR-INV-12. El público solo ve si una variante está disponible o agotada, nunca cantidades; el carrito indica por línea si la cantidad pedida puede surtirse (ADR-0061).
- BR-INV-13. Los movimientos de stock son append-only: nunca se modifican ni se borran. Todo cambio de `onHand` escribe su movimiento en la misma transacción, y la suma de movimientos de un stock item debe igualar su `onHand` (ADR-0011, ADR-0066).
- BR-INV-14. Las reservas actualizan cada stock item en orden ascendente de identificador, para evitar bloqueos mutuos entre transacciones concurrentes (ADR-0066).

## Datos personales

- BR-PRIV-01. El registro y el checkout de invitado guardan la versión del aviso de privacidad presentada (ADR-0067).
- BR-PRIV-02. Las solicitudes de derechos ARCO, incluida la eliminación de cuenta, se reciben por un canal externo publicado en el aviso de privacidad, y el staff las ejecuta en el sistema.
- BR-PRIV-03. Anonimizar a un cliente vacía sus datos de cuenta, borra tokens, direcciones y carritos, y elimina los identificadores directos de sus órdenes y envíos, conservando estado, municipio y código postal. Si tiene órdenes sin concluir, espera a que terminen. Los compradores invitados también pueden solicitarla.
- BR-PRIV-04. La auditoría registra que un campo personal cambió, sin su valor.
- BR-PRIV-05. Los datos personales de órdenes y envíos pasan por tres fases: operativa, bloqueo (ocultos, consulta solo con permiso específico y auditada) y anonimización. Los plazos de cada fase están PENDIENTES DE VALIDACIÓN LEGAL (P-61); el ciclo no se implementa en el MVP y no hay anonimización automática hasta entonces (ADR-0070).

## Direcciones

- BR-ADR-01. Una dirección tiene nombre de quien recibe, teléfono de 10 dígitos, calle, número exterior, colonia, código postal de 5 dígitos, municipio o alcaldía y estado como campos obligatorios; número interior, ciudad o localidad y referencias son opcionales; el país es México (ADR-0057). El nombre de quien recibe es un solo campo con el nombre completo, informativo para la paquetería.
- BR-ADR-02. Estado y municipio se eligen de una lista cerrada, y el municipio debe pertenecer al estado.
- BR-ADR-03. El catálogo de estados y municipios proviene del INEGI y se actualiza con un script manual; un municipio retirado se marca inactivo y no se usa en direcciones nuevas, pero se conserva en las existentes.
- BR-ADR-04. Un cliente tiene como máximo 10 direcciones (configurable).
- BR-ADR-05. El código postal solo se valida por formato en el MVP.

## Carrito

- BR-CRT-01. Una línea por variante.
- BR-CRT-02. Cantidad por línea mayor que cero y como máximo 30.
- BR-CRT-03. Solo un carrito activo es modificable. Un carrito activo por usuario.
- BR-CRT-04. El carrito no guarda precios como verdad ni reserva stock.
- BR-CRT-05. Al iniciar sesión, el carrito de invitado se fusiona sumando cantidades, con tope de 30 por línea y sin aviso.
- BR-CRT-06. Los carritos de invitado sin actividad durante 30 días se eliminan. Los carritos de usuarios registrados se conservan.
- BR-CRT-07. El carrito de invitado se identifica con un `cartId` opaco, aleatorio y no adivinable; la API no usa cookies (ADR-0010, ADR-0059).
- BR-CRT-08. Las cuentas de staff no tienen carrito (BR-USR-08).
- BR-CRT-09. La fusión se dispara con un endpoint explícito después de iniciar sesión; es idempotente; si el cliente no tiene carrito activo, el de invitado pasa a su cuenta; el carrito fusionado ya no se puede modificar; solo se fusionan carritos sin dueño (ADR-0059).
- BR-CRT-10. Al expirar una orden, sus líneas se suman al carrito activo del cliente registrado o reactivan el carrito original; tope de 30 por línea sin aviso (ADR-0054).
- BR-CRT-11. Las líneas de una orden Cancelled o Refunded pueden copiarse a un carrito para volver a comprarlas, con precios y disponibilidad actuales; la orden no cambia. Puede hacerlo el cliente dueño o, como apoyo, el staff con `orders.manage`, siempre hacia el carrito del cliente (ADR-0055).

## Pedidos

- BR-ORD-01. Una orden tiene al menos una línea.
- BR-ORD-02. Los totales los calcula el dominio; nunca se aceptan del cliente.
- BR-ORD-03. Las líneas guardan snapshot de SKU, nombre, opciones y precio, y son inmutables tras la colocación.
- BR-ORD-04. Se permite compra como invitado con email de contacto (ADR-0010).
- BR-ORD-05. Estados (ADR-0009): PendingPayment, Paid, AwaitingManualFulfillment, Shipped, Delivered, Cancelled, Expired, Refunded. Solo se permiten las transiciones de la tabla de `REQUIREMENTS.md` (sección 3.1).
- BR-ORD-06. Si el total recalculado en PlaceOrder no coincide con `expectedTotal`, la orden no se crea (ADR-0019).
- BR-ORD-07. Una orden en PendingPayment expira cuando vence su reserva.
- BR-ORD-08. Solo se marca pagada si el monto capturado es igual al total.
- BR-ORD-09. Si llega un pago para una orden expirada, se intenta reservar; si no hay stock, la orden pasa a AwaitingManualFulfillment (ADR-0012).
- BR-ORD-10. Un invitado consulta su pedido con email de contacto y el código público de la orden. Si perdió el código, lo atiende el staff por un canal externo; el enlace de acceso por correo queda fuera del MVP (ADR-0020, ADR-0077).
- BR-ORD-11. La consulta de invitado responde con el mismo error si la orden no existe o el email no coincide, y tiene rate limiting obligatorio (ADR-0020).
- BR-ORD-12. Cada orden tiene un número interno consecutivo, visible solo para el staff, y un código público aleatorio (`XXXX-XXXX`, Base32 Crockford) que es el único que ven los clientes (ADR-0049).
- BR-ORD-13. Una orden guarda como snapshot la dirección de envío, el costo de envío, el descuento (0 en el MVP) y, por línea, SKU, nombre, opciones, precio, tasa e importe de IVA (ADR-0018, ADR-0019, ADR-0027, ADR-0042).
- BR-ORD-14. Cuando una orden expira, sus líneas regresan al carrito del cliente (ADR-0054). Una orden cancelada nunca se reactiva (ADR-0055).
- BR-ORD-15. Colocar orden e iniciar pago exigen `Idempotency-Key`, ligada a quien la envía y al endpoint; un reintento con la misma llave y el mismo contenido no repite la operación (ADR-0063).
- BR-ORD-16. El total de la orden es subtotal + costo de envío − descuento; el IVA está contenido en el subtotal y en el costo de envío (precios y envío con IVA incluido, ADR-0008, ADR-0079). La base de datos verifica esta igualdad (ADR-0066).

## Pagos

- BR-PAY-01. Un Payment por orden.
- BR-PAY-02. El monto se obtiene de la orden, nunca del cliente.
- BR-PAY-03. Captura inmediata (ADR-0013).
- BR-PAY-04. Los reembolsos suman como máximo lo capturado.
- BR-PAY-05. Las transiciones son monótonas: un evento tardío o duplicado del proveedor no revierte un estado posterior.
- BR-PAY-06. Los webhooks se deduplican por ID de evento del proveedor.
- BR-PAY-07. No se ofrecen métodos de pago asíncronos en el lanzamiento.
- BR-PAY-08. Nunca se almacenan datos de tarjeta.
- BR-PAY-09. El pago manual (hecho fuera del sistema y registrado por un administrador) solo se usa en pruebas; está desactivado por defecto (ADR-0040).
- BR-PAY-10. Registrar un pago manual produce el mismo efecto que un pago capturado por un proveedor.
- BR-PAY-11. En el MVP solo hay reembolsos totales al cancelar una orden pagada; no hay reembolsos independientes ni parciales. El reembolso de un pago manual se hace fuera del sistema y lo registra un administrador con `payments.manage` (ADR-0018, ADR-0051).
- BR-PAY-12. El pago manual se hace físicamente en la tienda; la API indica pago en tienda con el código público y el total. Solo se registra sobre órdenes en PendingPayment o Expired (ADR-0055).
- BR-PAY-13. El adaptador de PayPal no se habilita hasta verificarse en sandbox (ADR-0040).
- BR-PAY-14. Un pago tiene como máximo un reembolso activo (pendiente o completado); lo garantiza un índice único parcial (ADR-0051, ADR-0066).

## Cancelaciones y devoluciones

- BR-CAN-01. No se cancela una orden en Shipped o posterior. Se puede cancelar en PendingPayment, Paid y AwaitingManualFulfillment.
- BR-CAN-02. Cancelar una orden pagada (Paid o AwaitingManualFulfillment) la lleva a Cancelled e inicia el reembolso total; al confirmarse el reembolso pasa a Refunded. Si el reembolso falla, permanece en Cancelled y se puede reintentar (ADR-0051).
- BR-CAN-03. Solo el personal con permiso `orders.manage` (Administrador y Superadministrador, ADR-0043) puede cancelar. El cliente no cancela desde la API (ADR-0021).
- BR-CAN-04. Devoluciones: fuera del MVP (ADR-0018).

## Promociones

Fuera del MVP (ADR-0018). La orden incluye un campo de descuento desde el inicio.

## Impuestos

- BR-TAX-01. Cada lista de precios indica si sus precios incluyen impuesto; por defecto, incluido (ADR-0008).
- BR-TAX-02. El impuesto se calcula y redondea por línea.
- BR-TAX-03. El país de operación es México. Todos los productos llevan IVA del 16%; la tasa es configurable (ADR-0026, ADR-0027).
- BR-TAX-04. Cada línea de orden guarda la tasa aplicada y el monto de impuesto como snapshot.
- BR-TAX-05. No se emiten facturas electrónicas (CFDI) por ahora (ADR-0027).
- BR-TAX-06. El costo de envío lleva IVA con la misma tasa, incluido en su monto; el IVA total de la orden suma el de las líneas y el del envío (ADR-0079).

## Envíos

- BR-SHP-01. No se crea un envío para una orden no pagada.
- BR-SHP-02. Una orden genera un solo envío en el MVP.
- BR-SHP-03. Delivered es un estado terminal.
- BR-SHP-04. Un envío se despacha por paquetería, con paquetería y número de guía, o como entrega propia de la tienda, marcada explícitamente y sin paquetería ni guía; la base de datos lo garantiza (ADR-0078).
- BR-SHP-05. Los envíos se gestionan manualmente: el envío se crea en Pending al pagarse la orden, y el staff con `shipping.manage` captura paquetería y guía y marca despachado, entregado o fallido (ADR-0041, ADR-0043).
- BR-SHP-06. El costo de envío es fijo por orden y es gratis cuando el subtotal con IVA menos el descuento alcanza un monto mínimo; ambos valores los configura el administrador (ADR-0042, ADR-0079).
- BR-SHP-07. El costo de envío se calcula al cotizar y queda como snapshot en la orden.
- BR-SHP-08. Tiempos de entrega comprometidos: PENDIENTE DE DEFINICIÓN (P-64).
- BR-SHP-09. Estados del envío: Pending → Dispatched → Delivered | DeliveryFailed; DeliveryFailed → Returned (ADR-0050, ADR-0053).
- BR-SHP-10. Una entrega fallida o una devolución no cambia el estado de la orden (Shipped) ni dispara reintentos, cancelaciones o reembolsos. Si la mercancía regresa, el staff marca el envío como Returned y reintegra el stock (ADR-0053).
- BR-SHP-11. Se permite la entrega propia de la tienda, con el mismo costo de envío, la misma dirección y los mismos estados que un envío por paquetería. Recoger en tienda queda fuera del MVP (ADR-0078).
- BR-SHP-12. El costo de envío configurado incluye IVA. El IVA contenido se calcula con la tasa configurada, se redondea como una línea y queda como snapshot en la orden; con envío gratis es 0. El costo de envío no cuenta para alcanzar el umbral (ADR-0079).
- BR-SHP-13. Solo Superadministrador y Administrador configuran el costo de envío y el umbral de envío gratis, con el permiso `shipping.configure`; el Operador no lo tiene (ADR-0075).

## Notificaciones

- BR-NTF-01. El cliente recibe un correo por orden recibida, pago confirmado, orden enviada, orden cancelada y reembolso completado (ADR-0074).
- BR-NTF-02. No se envía correo por orden expirada, orden entregada, entrega fallida, devolución, pago tardío sin stock ni pago fallido, y no hay notificaciones al staff (ADR-0074).
- BR-NTF-03. El destinatario es el email de contacto de la orden; las órdenes anonimizadas no reciben correo (ADR-0067, ADR-0074).
- BR-NTF-04. Los correos muestran solo el código público de la orden (ADR-0049), sin datos de pago ni tokens, y son transaccionales, sin contenido promocional. Un correo que no se pudo enviar no se reintenta y no afecta a la operación que lo originó (ADR-0014).
