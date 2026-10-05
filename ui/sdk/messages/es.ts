/**
 * The Spanish message catalog of `iam`'s screens: every key its login, one-time-code, two-factor,
 * password-recovery, phone, logout and consent views read, in wording that names no product.
 *
 * Plain data, renderer-agnostic and free of any `@zanix/space` import, so a consumer that builds its
 * own UI on the headless SDK can read it as well. Interpolate `{token}` placeholders (`{email}`,
 * `{provider}`, ...) with whatever templating the consumer's own i18n layer uses. Values are plain
 * strings with `{token}` placeholders, never ICU `select` or `plural`, so any templating engine reads
 * them; an app that wants a richer message overrides the key.
 *
 * A consumer changes any message by defining the same key in its own catalog: with `@zanix/space`,
 * declare {@linkcode iamMessages} in `messageSources` and the app's own `messagesDir` wins key by
 * key.
 */
export const IAM_UI_MESSAGES_ES: Readonly<Record<string, string>> = {
  'common/back-to-sign-in': 'Volver a ingresar',
  'common/invalid-or-expired-code': 'Código inválido o vencido.',
  'common/try-again': 'Intentar de nuevo',
  'common/verify': 'Verificar',
  'consent/heading': 'Consentimiento de cookies',
  'cookie-consent-modal/accept': 'Aceptar',
  'cookie-consent-modal/body':
    'Este servicio necesita guardar una cookie en tu navegador — la cookie de sesión — para mantenerte conectado entre páginas. Solo existe esta cookie en este proyecto; no se rastrea nada más.',
  'cookie-consent-modal/decline': 'Rechazar',
  'cookie-consent-modal/error': 'Algo falló al registrar tu elección. Intenta de nuevo.',
  'cookie-consent-modal/heading': 'Cookie de sesión',
  'login/email-label': 'Correo electrónico',
  'login/email-placeholder': 'tucorreo@ejemplo.com',
  'login/heading': 'Inicia sesión o crea una cuenta',
  'login/invalid-credentials': 'Correo o contraseña incorrectos.',
  'login/legal-and': 'y',
  'login/legal-prefix': 'Al continuar, aceptas nuestros',
  'login/no-account': 'No existe una cuenta para ese correo.',
  'login/oauth-continue': 'Continuar con {provider}',
  'login/oauth/callback-continue': 'Continuar',
  'login/oauth/callback-heading': 'Sesión iniciada',
  'login/oauth/error-body':
    'Algo falló al completar el inicio de sesión. Puedes intentarlo de nuevo desde la página de acceso.',
  'login/oauth/error-heading': 'No se completó el inicio de sesión',
  'login/countdown/announcement-done': 'Se acabó el tiempo',
  'login/countdown/announcement-less-than-minute': 'Queda menos de un minuto',
  'login/countdown/announcement-minutes': "'{minutes}' minutos restantes",
  'login/or-email': 'o continúa con tu correo',
  'login/otp/code-label': 'Código de verificación',
  'login/otp/heading': 'Ingresa tu código de verificación',
  'login/otp/notifier-email': 'Correo',
  'login/otp/notifier-sms': 'SMS',
  'login/otp/notifier-whatsapp': 'WhatsApp',
  'login/otp/resend': '¿No te llegó? Reenviar código',
  'login/otp/resend-cooldown': 'Ya te enviamos un código. Espera un momento antes de pedir otro.',
  'login/otp/resend-notifier-label': 'Enviar por',
  'login/otp/sent-to': 'Enviamos un código de verificación a {email}.',
  'login/password-hide': 'Ocultar contraseña',
  'login/password-label': 'Contraseña',
  'login/password-show': 'Mostrar contraseña',
  'login/password-step/forgot-password': '¿Olvidaste tu contraseña?',
  'login/password-step/heading': 'Ingresa tu contraseña',
  'login/password-step/invalid-password': 'Contraseña incorrecta.',
  'login/password-step/rate-limited':
    'Demasiados intentos. Espera un minuto antes de volver a intentarlo.',
  'login/password-step/rate-limited/body': 'Puedes volver a intentarlo en:',
  'login/password-step/rate-limited/heading':
    'Por tu seguridad, pausamos los intentos de inicio de sesión por un momento.',
  'login/password-step/signing-in-as': 'Ingresando como',
  'login/password-step/use-another-email': 'Usar otro correo',
  'login/privacy-link': 'Aviso de privacidad',
  'login/rate-limited': 'Demasiados intentos. Espera un minuto antes de volver a intentarlo.',
  'login/rate-limited/body': 'Puedes volver a intentarlo en:',
  'login/rate-limited/heading':
    'Por tu seguridad, pausamos los intentos de inicio de sesión por un momento.',
  'login/reactivate/body':
    'Si continúas, tu cuenta se reactivará automáticamente y podrás volver a usarla con normalidad.',
  'login/reactivate/cancel': 'Cancelar',
  'login/reactivate/confirm': 'Sí, reactivar mi cuenta',
  'login/reactivate/expired':
    'Este enlace de reactivación ya no es válido o expiró. Vuelve a iniciar sesión para pedir uno nuevo.',
  'login/reactivate/heading': 'Tu cuenta está desactivada',
  'login/session-expired': 'Tu sesión expiró. Vuelve a entrar para continuar.',
  'login/submit': 'Iniciar sesión',
  'login/subtext': 'Escribe tu correo o continúa con un proveedor de abajo.',
  'login/subtext-no-oauth': 'Escribe tu correo para continuar.',
  'login/terms-link': 'Términos y condiciones',
  'login/totp/code-label': 'Código de autenticación',
  'login/totp/heading': 'Ingresa el código de tu app de autenticación',
  'login/totp/invalid-code': 'Código de autenticación inválido.',
  'login/totp/rate-limited': 'Demasiados intentos. Espera un minuto antes de volver a intentarlo.',
  'login/totp/rate-limited/body': 'Puedes volver a intentarlo en:',
  'login/totp/rate-limited/heading':
    'Por tu seguridad, pausamos los intentos de inicio de sesión por un momento.',
  'login/totp/signing-in-as': 'Ingresando como {email}.',
  'login/totp/unexpected-error':
    'Algo no salió bien al verificar tu código. Intenta de nuevo en un momento.',
  'login/unexpected-error': 'Algo salió mal al iniciar tu sesión. Inténtalo de nuevo.',
  'logout/cancel-link': 'Mejor no',
  'logout/confirm-description': 'Tendrás que volver a ingresar en este dispositivo.',
  'logout/heading': 'Cerrar sesión',
  'logout/submit': 'Cerrar sesión',
  'password/recovery/callback-heading': 'Restablece tu contraseña',
  'password/recovery/callback-subtext': 'Enviamos un código de recuperación a {email}.',
  'password/recovery/code-label': 'Código de recuperación',
  'password/recovery/confirm-label': 'Confirmar contraseña',
  'password/recovery/have-code-link': 'Ya tengo mi código',
  'password/recovery/mismatch': 'Las contraseñas no coinciden.',
  'password/recovery/password-hide': 'Ocultar contraseña',
  'password/recovery/password-label': 'Nueva contraseña',
  'password/recovery/password-show': 'Mostrar contraseña',
  'password/recovery/request-body':
    'Si existe una cuenta para {email}, se envió un código de recuperación.',
  'password/recovery/request-heading': 'Revisa tu correo',
  'password/recovery/submit': 'Restablecer contraseña',
  'password/recovery/weak-password': 'Esta contraseña no cumple los requisitos de contraseña.',
  'phone/confirm/code-label': 'Código de verificación',
  'phone/confirm/heading': 'Ingresa el código que te enviamos',
  'phone/confirm/sent-to': 'Enviamos un código a {phone}.',
  'phone/enroll/body':
    'Te enviaremos un código de un solo uso para confirmar que este número es tuyo.',
  'phone/enroll/heading': 'Verifica tu número de teléfono',
  'phone/enroll/phone-label': 'Número de teléfono',
  'phone/enroll/phone-placeholder': '+52 55 1234 5678',
  'phone/enroll/submit': 'Enviar código',
  'totp/confirm/heading': 'Confirmar app de autenticación',
  'totp/enroll/code-label': 'Código de autenticación',
  'totp/enroll/heading': 'Configurar una app de autenticación',
  'totp/enroll/invalid-code':
    'Código de autenticación inválido — escanea el nuevo código a continuación.',
  'totp/enroll/scan-aria-label': 'Escanea este código QR con tu app de autenticación',
  'totp/enroll/scan-instructions':
    'Escanéalo con tu app de autenticación, o ingresa la clave manualmente:',
  'totp/enroll/submit': 'Confirmar',
}
