export interface ClassifiedError {
  code: number;
  retryable: boolean;
  friendly: string;
  /** Token inválido o vencido: el canal queda desconectado hasta reconectar. */
  disconnect: boolean;
}

/**
 * E04-S03 — Errores de la Cloud API traducidos a algo que un vendedor entiende.
 * Códigos según la documentación de Meta (verificar al actualizar la versión de Graph API).
 */
const KNOWN: Record<number, Omit<ClassifiedError, 'code'>> = {
  131047: { retryable: false, disconnect: false, friendly: 'Pasaron más de 24 horas desde el último mensaje del cliente: solo puedes enviar una plantilla aprobada.' },
  131026: { retryable: false, disconnect: false, friendly: 'El mensaje no se pudo entregar: el número no usa WhatsApp o bloqueó a la empresa.' },
  131051: { retryable: false, disconnect: false, friendly: 'Ese tipo de mensaje no está soportado.' },
  131052: { retryable: false, disconnect: false, friendly: 'No se pudo descargar el archivo adjunto.' },
  131053: { retryable: false, disconnect: false, friendly: 'No se pudo subir el archivo: revisa formato y tamaño.' },
  132000: { retryable: false, disconnect: false, friendly: 'Los parámetros no coinciden con la plantilla.' },
  132001: { retryable: false, disconnect: false, friendly: 'La plantilla no existe o no está aprobada en ese idioma.' },
  131048: { retryable: false, disconnect: false, friendly: 'Meta limitó los envíos de este número por reportes de spam. Revisa la calidad del número.' },
  130429: { retryable: true, disconnect: false, friendly: 'Se alcanzó el límite de envío por segundo del número; se reintentará.' },
  131056: { retryable: true, disconnect: false, friendly: 'Demasiados mensajes seguidos al mismo cliente; se reintentará en unos segundos.' },
  131000: { retryable: true, disconnect: false, friendly: 'Error temporal de WhatsApp; se reintentará.' },
  131016: { retryable: true, disconnect: false, friendly: 'WhatsApp no está disponible en este momento; se reintentará.' },
  190: { retryable: false, disconnect: true, friendly: 'La conexión con WhatsApp venció: el propietario debe reconectar el número.' },
  133010: { retryable: false, disconnect: true, friendly: 'El número no está registrado en la Cloud API: hay que reconectarlo.' },
};

export function classifyMetaError(error: { code?: number; message?: string } | undefined, httpStatus: number): ClassifiedError {
  const code = Number(error?.code ?? 0);
  const known = KNOWN[code];
  if (known) return { code, ...known };
  const retryable = httpStatus === 429 || httpStatus >= 500;
  return {
    code,
    retryable,
    disconnect: false,
    friendly: retryable ? 'Error temporal de WhatsApp; se reintentará.' : 'WhatsApp rechazó el mensaje. Revisa el contenido e inténtalo de nuevo.',
  };
}
