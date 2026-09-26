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

Shared kernel: `Money`, tipos de ID, error de dominio base, forma común de domain event.

---

## Identity & Access

| Elemento | Detalle |
|---|---|
| Aggregates | `User` (tipo cliente o staff, email, passwordHash, status, roleIds solo para staff, emailVerifiedAt, cambio de contraseña obligatorio); `Role` (nombre, permisos); `CustomerAddressBook` (direcciones, predeterminada) |
| Value Objects | `Email`, `PermissionCode`, `Address` (formato de ADR-0057), `PersonName` (nombres y apellidos) |
| Eventos | `UserRegistered`, `UserSuspended`, `RolePermissionsChanged` |
| Repositories | `UserRepository`, `RoleRepository`, `AddressBookRepository` |
| Casos de uso | RegisterCustomer, Authenticate, RefreshSession, Logout, ChangePassword, RequestPasswordReset, ResetPassword, CreateStaffUser, AssignRoles, DefineRole, SuspendUser, ReactivateUser (ADR-0076), ManageAddresses |
| No sale del contexto | passwordHash, tokens, intentos de login, datos de recuperación |

Autenticación: ADR-0022 y ADR-0023. Los refresh tokens son infraestructura del contexto; su revocación responde a `UserSuspended`.

## Catalog

| Elemento | Detalle |
|---|---|
| Aggregates | `Product` (título, descripción, brandId, categoryIds, status; contiene `ProductVariant`, con peso y dimensiones opcionales, y `ProductImage`); `Category` (árbol por parentId); `Brand` |
| Value Objects | `Sku`, `Slug`, `VariantOptions` |
| Eventos | `ProductPublished`, `ProductArchived`, `VariantDiscontinued` |
| Repositories | `ProductRepository`, `CategoryRepository`, `BrandRepository`; `CatalogQueryService` (lectura) |
| Casos de uso | CreateProduct, UpdateProductDetails, AddVariant, DiscontinueVariant, ReactivateVariant, PublishProduct, ArchiveProduct, ReactivateProduct (ADR-0076), AttachImage, ReorderImages, ManageCategories, ManageBrands; consultas ListProducts, GetProductBySlug |
| Exporta | Snapshot de variante: SKU, nombre, opciones, peso y dimensiones (opcionales, ADR-0058), estado |

## Pricing

| Elemento | Detalle |
|---|---|
| Aggregates | `PriceList` (código, moneda, prioridad, status, alcance, indicador de impuesto incluido); `VariantPrice` (por lista y variante, con periodos `PricePeriod`) |
| Value Objects | `Money`, `EffectivePeriod` |
| Domain services | `PriceResolver` |
| Eventos | `PriceScheduled`, `PriceChanged` (solo si tienen consumidor) |
| Repositories | `PriceListRepository`, `VariantPriceRepository` |
| Casos de uso | CreatePriceList, SetPrice, SchedulePrice, CancelScheduledPrice, BulkImportPrices, QuotePrices (API pública) |
| Exporta | Precio resuelto por variante e instante |

## Inventory

| Elemento | Detalle |
|---|---|
| Aggregates | `Warehouse`; `StockItem` (por variante y almacén: onHand, reserved, version); `Reservation` (referencia, líneas, status, expiresAt) |
| Registros | `StockMovement` (append-only, no es aggregate) |
| Domain services | Asignación de almacén (un solo almacén hoy) |
| Eventos | `StockReserved`, `ReservationReleased`, `ReservationExpired`, `ReservationCommitted`, `StockAdjusted` |
| Repositories | `WarehouseRepository`, `StockItemRepository`, `ReservationRepository` |
| Casos de uso | ReceiveStock, AdjustStock, RestockOrder (órdenes canceladas o con envío devuelto, ADR-0052, ADR-0053), ReserveStock, CommitReservation, ReleaseReservation, ExpireReservations (job), GetAvailability |
| Exporta | Disponibilidad agregada, resultado de reserva |

## Shopping

| Elemento | Detalle |
|---|---|
| Aggregates | `Cart` (ownerId opcional, líneas `CartLine`, status Active/CheckedOut/Merged) |
| Eventos | Ninguno propio; reacciona a `OrderPlaced` y `OrderExpired` (ADR-0054) |
| Repositories | `CartRepository` |
| Casos de uso | CreateCart, AddItem, ChangeQuantity, RemoveItem, MergeGuestCart, GetCartView, RestoreCartFromExpiredOrder (ADR-0054), CopyCancelledOrderToCart (ADR-0055) |
| Exporta | Líneas del carrito (variantId, cantidad) |

## Ordering

| Elemento | Detalle |
|---|---|
| Aggregates | `Order` (número interno consecutivo, código público aleatorio, customerId opcional, email de contacto, líneas `OrderLine` con snapshot, dirección snapshot, envío snapshot, descuento, impuestos, totales, status, reservationId, historial de estados) |
| Value Objects | `Money`, `Address`, `OrderNumber` (interno), `OrderCode` (público, formato `XXXX-XXXX`) |
| Eventos | `OrderPlaced`, `OrderPaid`, `OrderCancelled`, `OrderExpired`, `OrderShipped`, `OrderDelivered` |
| Repositories | `OrderRepository`; puertos `OrderNumberGenerator` (secuencia) y `OrderCodeGenerator` (aleatorio, ADR-0049) |
| Casos de uso | QuoteCheckout, PlaceOrder, CancelOrder (solo staff, ADR-0021), MarkOrderPaid, ExpireUnpaidOrders (job), ResolveManualFulfillment; consultas GetOrder, ListMyOrders, ListOrders, GetGuestOrder (email + código público, ADR-0020, ADR-0049) |
| Exporta | orderId, total, snapshot de dirección e ítems |

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

## Shipping

| Elemento | Detalle |
|---|---|
| Aggregates | `Shipment` (orderId, almacén, destino, ítems, paquetería, guía o entrega propia (ADR-0078), status: Pending, Dispatched, Delivered, DeliveryFailed, Returned — ADR-0050, ADR-0053); `ShippingMethod` (costo fijo y monto mínimo para envío gratis) |
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
| Ordering → Inventory | Reservar, confirmar, liberar | Comando síncrono en checkout; comandos por eventos |
| Shopping ↔ Ordering | Contenido del carrito / líneas de órdenes expiradas o canceladas | Fachada síncrona; Shopping reacciona a `OrderPlaced` y `OrderExpired` |
| Ordering ↔ Payments | Iniciar pago y reembolso / resultado | Comando síncrono / eventos `PaymentCaptured`, `PaymentFailed`, `RefundCompleted` (lleva la orden a Refunded, ADR-0051) |
| Ordering → Shipping | Orden pagada | Evento `OrderPaid` |
| Shipping → Ordering | Progreso del envío | Eventos `ShipmentDispatched`, `ShipmentDelivered` |
| Ordering, Payments, Shipping → Notificaciones | Datos para los correos al cliente | Eventos `OrderPlaced`, `OrderPaid`, `OrderCancelled`, `RefundCompleted`, `ShipmentDispatched`; email de contacto y datos de la orden por la fachada de Ordering (ADR-0074) |

## Flujo de checkout y pago (ADR-0019)

1. Transacción: validar carrito, cotizar precios y comparar con `expectedTotal`, reservar stock, crear orden en PendingPayment, marcar carrito.
2. Fuera de transacción: iniciar el pago con el proveedor (idempotency key = ID de la orden).
3. Webhook: deduplicar evento del proveedor, actualizar Payment, publicar `PaymentCaptured`.
4. Handlers idempotentes: marcar la orden como pagada y confirmar la reserva.
5. Jobs: expirar reservas y órdenes impagas; conciliar pagos capturados con órdenes en PendingPayment.
