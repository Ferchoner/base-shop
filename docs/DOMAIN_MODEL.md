# DOMAIN MODEL

Modelo de dominio por bounded context. Estado: **aprobado** (ADR-0004, ADR-0005). Las reglas de negocio detalladas están en `BUSINESS_RULES.md`.

Convención: los nombres de código (aggregates, eventos, casos de uso) van en inglés; las explicaciones, en español.

## Mapa de contextos

| Contexto | Tipo | Responsabilidad |
|---|---|---|
| Identity & Access | Generic | Autenticación, usuarios, roles, asignación de permisos, direcciones del cliente |
| Catalog | Supporting | Productos, variantes, categorías, marcas, imágenes, publicación. No maneja precio ni stock |
| Pricing | Core | Listas de precios, precios históricos y programados, resolución del precio vigente |
| Inventory | Core | Almacenes, existencias, reservas, movimientos |
| Shopping | Supporting | Carrito |
| Ordering | Core | Checkout y ciclo de vida de la orden |
| Payments | Generic | Cobros vía proveedores, intentos, reembolsos, conciliación |
| Shipping | Supporting | Cotización de envíos, envíos, rastreo |

Capacidades transversales (no son contextos): auditoría técnica, notificaciones por correo (ADR-0074) y catálogo geográfico de estados y municipios del INEGI (dato de referencia de solo lectura, ADR-0057).

Shared kernel: `Money`, tipos de ID, error de dominio base, forma común de domain event, y los puertos `Clock`, `TransactionManager`, `DomainEventPublisher`, `AuditTrail`, `EmailSender` y `FrontendLinks` (ADR-0093, ADR-0094, ADR-0098, ADR-0100, ADR-0110).

---

## Identity & Access

| Elemento | Detalle |
|---|---|
| Aggregates | `User` (tipo cliente o staff, email, passwordHash, status, roleIds solo para staff, emailVerifiedAt, cambio de contraseña obligatorio); `Role` (nombre, permisos); `CustomerAddressBook` (direcciones, predeterminada) |
| Value Objects | `Email`, `PermissionCode`, `Address` (formato de ADR-0057), `PersonName` (nombres y apellidos) |
| Eventos | `UserRegistered`, `UserSuspended`, `RolePermissionsChanged` |
| Repositories | `UserRepository`, `RoleRepository`, `AddressBookRepository`, `SessionRepository` (refresh tokens por sesión, ADR-0114) |
| Casos de uso | RegisterCustomer, Authenticate (`SignIn`), RefreshSession, Logout (`SignOut`), ChangePassword, RequestPasswordReset, ResetPassword, CreateStaffUser, AssignRoles, DefineRole, SuspendUser, ReactivateUser (ADR-0076), ManageAddresses |
| No sale del contexto | passwordHash, tokens, intentos de login, datos de recuperación |

Autenticación: ADR-0022, ADR-0023 y ADR-0114. La política de contraseñas (ADR-0047) es una regla del dominio (`domain/password.ts`), aplicada por `PasswordPolicy` con el puerto `CommonPasswords` (ADR-0115). Los refresh tokens de un inicio de sesión forman una sesión, que se revoca completa. Suspender una cuenta revoca sus sesiones en la misma transacción (ADR-0111), no en respuesta a `UserSuspended`.

## Catalog

| Elemento | Detalle |
|---|---|
| Aggregates | `Product` (título, descripción, brandId, categoryIds, status; contiene `ProductVariant`, con peso y dimensiones opcionales, y `ProductImage`); `Category` (árbol por parentId); `Brand` |
| Value Objects | `Sku`, `Slug`, `VariantOptions` |
| Eventos | `ProductPublished`, `ProductArchived`, `VariantDiscontinued` |
| Repositories | `ProductRepository`, `CategoryRepository`, `BrandRepository`; `CatalogQueryService` (lectura) |
| Casos de uso | CreateProduct, UpdateProductDetails, AddVariant, DiscontinueVariant, ReactivateVariant, PublishProduct, ArchiveProduct, ReactivateProduct (ADR-0076), AttachImage, ReorderImages, ManageCategories, ManageBrands; consultas ListProducts, GetProductBySlug |
| Exporta | Snapshot de variante: SKU, nombre, opciones, peso y dimensiones (opcionales, ADR-0058), estado; fachada `CatalogFacade.variants` (ADR-0125) |

## Pricing

| Elemento | Detalle |
|---|---|
| Aggregates | `PriceList` (código, moneda, prioridad, status, alcance, indicador de impuesto incluido); `VariantPrice` (por lista y variante, con periodos `PricePeriod`) |
| Value Objects | `Money`, `EffectivePeriod` |
| Domain services | `PriceResolver`; en el MVP, `PricingFacade.quote` resuelve con la lista predeterminada (ADR-0125) |
| Eventos | `PriceScheduled`, `PriceChanged` (solo si tienen consumidor; ninguno todavía, ADR-0125) |
| Repositories | `PriceListRepository`, `VariantPriceRepository` |
| Casos de uso | CreatePriceList (fuera del MVP), SetPrice, SchedulePrice, CancelScheduledPrice (`VariantPrices`), BulkImportPrices (`ImportPrices`, ADR-0126), QuotePrices (API pública) |
| Exporta | Precio resuelto por variante e instante (`PricingFacade.quote`, ADR-0125) |

## Inventory

| Elemento | Detalle |
|---|---|
| Aggregates | `Warehouse`; `StockItem` (por variante y almacén: onHand, reserved, version); `Reservation` (referencia, líneas, status, expiresAt) |
| Registros | `StockMovement` (append-only, no es aggregate) |
| Domain services | Asignación de almacén (un solo almacén hoy) |
| Eventos | `StockReserved`, `ReservationReleased`, `ReservationExpired`, `ReservationCommitted`, `StockAdjusted` (solo si tienen consumidor; ninguno todavía, ADR-0128) |
| Repositories | `WarehouseRepository`, `StockLedgerRepository` (cambios atómicos de `stock_items` con su movimiento, ADR-0127), `ReservationRepository` |
| Casos de uso | ReceiveStock y AdjustStock (`StockEntries`), UpdateWarehouse, StockListing (ADR-0127), RestockOrder (órdenes canceladas o con envío devuelto, ADR-0052, ADR-0053), ReserveStock, CommitReservation, ReleaseReservation, ExpireReservations (job), GetAvailability |
| Exporta | `InventoryFacade`: `canFulfill` (sí o no por línea), `reserve`, `commit` y `release` por orden (ADR-0128); `reserve` es todo o nada por sí misma, también dentro de la transacción de quien llama (ADR-0133) |

## Shopping

| Elemento | Detalle |
|---|---|
| Aggregates | `Cart` (ownerId opcional, líneas `CartLine`, status Active/CheckedOut/Merged) |
| Eventos | Ninguno propio; reacciona a `OrderExpired` (ADR-0054). El carrito se marca dentro de la transacción del checkout, no por `OrderPlaced` (ADR-0019) |
| Repositories | `CartRepository` |
| Casos de uso | CreateCart, AddItem, ChangeQuantity, RemoveItem, MergeGuestCart, GetCartView, RestoreCartFromExpiredOrder (ADR-0054), CopyCancelledOrderToCart (ADR-0055) |
| Exporta | `ShoppingFacade` para el checkout: líneas del carrito (variantId, cantidad), el carrito bloqueado y marcarlo CheckedOut (ADR-0132) |
| Implementado | T-170 (ADR-0131): `Cart` con sus reglas (una línea por variante, de 1 a 30 unidades, hasta 100 variantes, solo el carrito activo cambia, fusión y adopción); puertos `CartCatalog`, `CartPrices` y `CartStock` hacia las fachadas de Catalog, Pricing e Inventory. T-181 parte a (ADR-0137): `CartRestoration` y el manejador de `OrderExpired` devuelven las líneas de una orden vencida |

## Ordering

| Elemento | Detalle |
|---|---|
| Aggregates | `Order` (número interno consecutivo, código público aleatorio, customerId opcional, email de contacto, líneas `OrderLine` con snapshot, dirección snapshot, envío snapshot, descuento, impuestos, totales, status, reservationId, historial de estados) |
| Value Objects | `Money`, `Address`, `OrderNumber` (interno), `OrderCode` (público, formato `XXXX-XXXX`) |
| Eventos | `OrderPlaced`, `OrderPaid`, `OrderCancelled`, `OrderExpired`, `OrderShipped`, `OrderDelivered` |
| Repositories | `OrderRepository`; puertos `OrderNumberGenerator` (secuencia) y `OrderCodeGenerator` (aleatorio, ADR-0049) |
| Casos de uso | QuoteCheckout, PlaceOrder, CancelOrder (solo staff, ADR-0021), MarkOrderPaid, ExpireUnpaidOrders (job), ResolveManualFulfillment; consultas GetOrder, ListMyOrders, ListOrders, GetGuestOrder (email + código público, ADR-0020, ADR-0049) |
| Exporta | orderId, total, snapshot de dirección e ítems |
| Implementado | T-180 parte a (ADR-0132): `Order` nace en PendingPayment con sus líneas numeradas, totales e IVA por línea, código público aleatorio y vencimiento del pago; caso de uso `Checkout` (cotizar y colocar); puertos hacia las fachadas de Shopping, Catalog, Pricing, Inventory, Shipping, Identity & Access y Geo. T-180 parte b (ADR-0133): transiciones de cancelar, pagar, esperar surtido y surtir con su historial; caso de uso `OrderLifecycle` y manejador de `PaymentCaptured`. T-230 (ADR-0136): vencimiento con su reserva (`OrderExpiry`, job `ordering.expire-orders`) y `OrderExpired` |

## Payments

| Elemento | Detalle |
|---|---|
| Aggregates | `Payment` (uno por orden; contiene `PaymentAttempt` y `Refund`) |
| Estados | Pending, RequiresAction, Authorized, Captured, Failed, Cancelled, PartiallyRefunded, Refunded |
| Eventos | `PaymentAuthorized`, `PaymentCaptured`, `PaymentFailed`, `RefundCompleted` |
| Repositories | `PaymentRepository` |
| Puertos | `PaymentGateway`: adaptador manual (pruebas) y PayPal semiimplementado (ADR-0040) |
| Casos de uso | InitiatePayment, RegisterManualPayment (staff, solo pruebas), HandleProviderWebhook, RefundPayment (total, al cancelar), RegisterManualRefund (staff, solo pruebas), RetryRefund, ReconcilePayments (job) |
| Exporta | Estado del pago por orderId |
| Implementado | T-190 parte a (ADR-0134): `Payment` con sus intentos (iniciar y capturar a mano); `PaymentsFacade` para Ordering (iniciar, registrar el pago manual, pagos por orden) y `PaymentCaptured`. Parte b (ADR-0135): `Refund` (iniciar al cancelar, completar a mano), cancelar el pago pendiente y `RefundCompleted` |

## Shipping

| Elemento | Detalle |
|---|---|
| Aggregates | `Shipment` (orderId, almacén, destino, ítems, paquetería, guía o entrega propia (ADR-0078), status: Pending, Dispatched, Delivered, DeliveryFailed, Returned — ADR-0050, ADR-0053); `ShippingMethod` (costo fijo, monto mínimo para envío gratis y plazo de entrega estimado, ADR-0083) |
| Domain services | `ShippingRateCalculator` |
| Eventos | `ShipmentCreated`, `ShipmentDispatched`, `ShipmentDelivered`, `DeliveryFailed`, `ShipmentReturned` |
| Repositories | `ShipmentRepository`, `ShippingMethodRepository` |
| Puertos | Ninguno por ahora; `CarrierGateway` se crea con la primera integración real (ADR-0041) |
| Casos de uso | QuoteShippingOptions (costo fijo con IVA incluido o gratis por monto, ADR-0042, ADR-0079), CreateShipmentForOrder (automático al pagarse la orden), RegisterTracking (paquetería y guía, manual), MarkDispatched, MarkDelivered, MarkDeliveryFailed, MarkReturned (ADR-0053) |

Envíos manuales (ADR-0041). Costo de envío fijo, gratis a partir de un monto mínimo (ADR-0042).

Estados previstos para cuando exista integración con paqueterías (no implementados, ADR-0050): guía generada y en tránsito.

---

## Relaciones entre contextos

| Upstream → Downstream | Qué fluye | Mecanismo |
|---|---|---|
| Identity → todos | userId y permisos | Token de acceso JWT de corta duración en `Authorization: Bearer`, emitido por Identity; los permisos se resuelven desde los roles del usuario (ADR-0017, ADR-0022, ADR-0023) |
| Catalog → Pricing, Inventory, Shopping, Ordering, Shipping | variantId, snapshot de variante | Fachada síncrona; eventos `VariantDiscontinued`, `ProductArchived` |
| Pricing → Shopping, Ordering | Precios cotizados | Fachada síncrona `QuotePrices` |
| Ordering → Inventory | Reservar, confirmar, liberar; reintegrar con las líneas y lo vendido (P-73) | Comando síncrono en checkout; comandos por eventos (ADR-0132) |
| Identity → Ordering | Contacto del cliente y direcciones guardadas | Fachada síncrona; Identity nunca usa a Ordering (ADR-0132) |
| Shopping ↔ Ordering | Contenido del carrito / líneas de órdenes expiradas o canceladas | Fachada síncrona; el checkout marca el carrito en su transacción (ADR-0019); Shopping reacciona a `OrderExpired` |
| Ordering ↔ Payments | Iniciar pago y reembolso / resultado | Comando síncrono / eventos `PaymentCaptured`, `PaymentFailed`, `RefundCompleted` (lleva la orden a Refunded, ADR-0051). Ordering escucha `PaymentCaptured { orderId, paymentId, amount }` desde T-180 (ADR-0133). Ordering usa `PaymentsFacade` y Payments nunca usa a Ordering (ADR-0134). Ordering escucha `RefundCompleted` desde T-190 parte b (ADR-0135) |
| Ordering → Shipping | Orden pagada | Evento `OrderPaid` |
| Shipping → Ordering | Progreso del envío | Eventos `ShipmentDispatched`, `ShipmentDelivered` |
| Ordering, Payments, Shipping → Notificaciones | Datos para los correos al cliente | Eventos `OrderPlaced`, `OrderPaid`, `OrderCancelled`, `RefundCompleted`, `ShipmentDispatched`; email de contacto y datos de la orden por la fachada de Ordering (ADR-0074) |

## Flujo de checkout y pago (ADR-0019)

1. Transacción: validar carrito, cotizar precios y comparar con `expectedTotal`, reservar stock, crear orden en PendingPayment, marcar carrito.
2. Fuera de transacción: iniciar el pago con el proveedor (idempotency key = ID de la orden).
3. Webhook: deduplicar evento del proveedor, actualizar Payment, publicar `PaymentCaptured`.
4. Handlers idempotentes: marcar la orden como pagada y confirmar la reserva.
5. Jobs: expirar reservas y órdenes impagas; conciliar pagos capturados con órdenes en PendingPayment.
