/** One entry of the problem type catalog: HTTP status plus the Spanish texts shown to people (ADR-0071). */
export interface ProblemType {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
}

/**
 * Problem types of `API_SPEC.md` §6.2 (ADR-0064, ADR-0095). Clients decide by `type`; `title` and `detail`
 * are fixed Spanish texts for people and never carry internal data.
 */
export const PROBLEM_TYPES = {
  'validation-error': {
    status: 400,
    title: 'Solicitud inválida',
    detail: 'Uno o más campos no son válidos.',
  },
  'password-policy-violation': {
    status: 400,
    title: 'Contraseña no permitida',
    detail:
      'La contraseña debe tener entre 15 y 64 caracteres y no puede ser una contraseña común.',
  },
  'invalid-or-expired-token': {
    status: 400,
    title: 'Enlace inválido o vencido',
    detail: 'El enlace ya se usó, venció o fue reemplazado por uno nuevo.',
  },
  'idempotency-key-missing': {
    status: 400,
    title: 'Falta la llave de idempotencia',
    detail: 'Esta operación requiere el encabezado Idempotency-Key.',
  },
  unauthenticated: {
    status: 401,
    title: 'No autenticado',
    detail: 'La solicitud requiere un token de acceso válido.',
  },
  'invalid-credentials': {
    status: 401,
    title: 'Credenciales no válidas',
    detail: 'No se pudo iniciar sesión con los datos proporcionados.',
  },
  'invalid-refresh-token': {
    status: 401,
    title: 'Sesión no válida',
    detail: 'La sesión venció o ya no es válida. Inicia sesión de nuevo.',
  },
  'invalid-webhook-signature': {
    status: 401,
    title: 'Firma no válida',
    detail: 'La firma del webhook no es válida.',
  },
  forbidden: {
    status: 403,
    title: 'Acceso denegado',
    detail: 'No tienes permiso para realizar esta acción.',
  },
  'email-not-verified': {
    status: 403,
    title: 'Correo sin verificar',
    detail: 'Verifica tu correo electrónico antes de colocar una orden.',
  },
  'staff-cannot-purchase': {
    status: 403,
    title: 'Operación no permitida para el staff',
    detail: 'Las cuentas del staff no pueden usar el carrito ni comprar.',
  },
  'password-change-required': {
    status: 403,
    title: 'Cambio de contraseña pendiente',
    detail: 'Debes cambiar tu contraseña antes de continuar.',
  },
  'manual-payments-disabled': {
    status: 403,
    title: 'Pagos manuales deshabilitados',
    detail: 'Los pagos y reembolsos manuales no están habilitados.',
  },
  'not-found': {
    status: 404,
    title: 'No encontrado',
    detail: 'El recurso solicitado no existe.',
  },
  'version-conflict': {
    status: 409,
    title: 'Versión desactualizada',
    detail:
      'El recurso cambió desde que lo consultaste. Vuelve a cargarlo e intenta de nuevo.',
  },
  'total-mismatch': {
    status: 409,
    title: 'El total cambió',
    detail:
      'El total de la orden cambió. Revisa la nueva cotización antes de continuar.',
  },
  'insufficient-stock': {
    status: 409,
    title: 'Stock insuficiente',
    detail:
      'Algunos productos no tienen existencias suficientes para la cantidad solicitada.',
  },
  'variant-not-sellable': {
    status: 409,
    title: 'Producto no disponible',
    detail: 'Algunos productos ya no están disponibles para la venta.',
  },
  'invalid-state-transition': {
    status: 409,
    title: 'Acción no permitida en el estado actual',
    detail: 'La acción no se puede realizar en el estado actual del recurso.',
  },
  'duplicate-value': {
    status: 409,
    title: 'Valor duplicado',
    detail: 'El valor ya está en uso.',
  },
  'resource-in-use': {
    status: 409,
    title: 'Recurso en uso',
    detail: 'No se puede eliminar porque otros registros lo usan.',
  },
  'price-period-conflict': {
    status: 409,
    title: 'Periodo de precio en conflicto',
    detail: 'El periodo se superpone con otro o ya inició.',
  },
  'idempotency-request-in-progress': {
    status: 409,
    title: 'Solicitud en proceso',
    detail:
      'La solicitud original con esta llave de idempotencia sigue en proceso.',
  },
  'cart-not-active': {
    status: 409,
    title: 'Carrito no activo',
    detail: 'El carrito ya no se puede modificar.',
  },
  'cart-line-limit-reached': {
    status: 409,
    title: 'Límite del carrito',
    detail: 'El carrito ya tiene el máximo de productos distintos.',
  },
  'image-limit-reached': {
    status: 409,
    title: 'Límite de imágenes',
    detail: 'El producto ya tiene el máximo de imágenes.',
  },
  'address-limit-reached': {
    status: 409,
    title: 'Límite de direcciones',
    detail: 'Alcanzaste el máximo de direcciones guardadas.',
  },
  'last-superadmin': {
    status: 409,
    title: 'Último superadministrador',
    detail: 'El sistema debe conservar al menos un superadministrador activo.',
  },
  'restock-not-allowed': {
    status: 409,
    title: 'Reintegro no permitido',
    detail: 'El reintegro supera lo vendido o ya se hizo.',
  },
  'active-orders-exist': {
    status: 409,
    title: 'Órdenes sin concluir',
    detail: 'La cuenta tiene órdenes sin concluir.',
  },
  'field-locked': {
    status: 409,
    title: 'Campo bloqueado',
    detail:
      'Algunos campos ya no se pueden modificar después de la primera publicación.',
  },
  'empty-cart': {
    status: 409,
    title: 'Carrito vacío',
    detail: 'El carrito no tiene productos.',
  },
  'source-cart-unavailable': {
    status: 409,
    title: 'Carrito original no disponible',
    detail:
      'El carrito original de la orden ya no existe, así que no se puede recomprar.',
  },
  'idempotency-key-mismatch': {
    status: 422,
    title: 'Llave de idempotencia reutilizada',
    detail: 'La llave de idempotencia ya se usó con otro contenido.',
  },
  'payload-too-large': {
    status: 413,
    title: 'Contenido demasiado grande',
    detail: 'El archivo o la solicitud supera el tamaño permitido.',
  },
  'unsupported-media-type': {
    status: 415,
    title: 'Formato no admitido',
    detail: 'El formato del archivo o el tipo de contenido no se admite.',
  },
  'rate-limit-exceeded': {
    status: 429,
    title: 'Demasiadas solicitudes',
    detail: 'Superaste el límite de solicitudes. Intenta más tarde.',
  },
  'internal-error': {
    status: 500,
    title: 'Error interno',
    detail:
      'Ocurrió un error inesperado. Si persiste, comparte el identificador de correlación con soporte.',
  },
} as const satisfies Record<string, ProblemType>;

export type ProblemCode = keyof typeof PROBLEM_TYPES;

export function isProblemCode(code: string): code is ProblemCode {
  return Object.hasOwn(PROBLEM_TYPES, code);
}

/** The `type` member: a stable relative URI (ADR-0064). */
export function problemTypeUri(code: string): string {
  return `/problems/${code}`;
}
