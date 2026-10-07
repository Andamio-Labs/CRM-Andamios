# WhatsApp en BeeCRM

## Multimedia (E04-S06)

Los archivos que mandan los clientes se descargan de Meta al recibirlos (las URLs de Meta vencen en minutos),
se guardan en nuestro almacenamiento y se leen siempre con una **URL firmada que vence a los 15 minutos**.

| Tipo | Límite | Se muestra en la conversación |
|---|---|---|
| Imágenes (jpeg, png, webp) | 5 MB | Sí |
| Audio y notas de voz (ogg, mpeg, aac, amr, mp4) | 16 MB | Sí, con reproductor |
| Video (mp4, 3gpp) | 16 MB | Sí, con reproductor |
| PDF | 100 MB | Sí |
| Otros documentos | 100 MB | No: se ofrecen como descarga |

Son los mismos límites de la WhatsApp Cloud API. Un archivo más grande queda marcado como
"demasiado grande" y no se guarda.

**Seguridad:** solo los tipos de la tabla se muestran en línea. Cualquier otro (SVG, HTML, etc.) se sirve como
descarga con `Content-Type: application/octet-stream`. Todas las respuestas llevan `Content-Security-Policy: sandbox`,
así un archivo malicioso no puede ejecutar código en el dominio de BeeCRM.

Almacenamiento: disco local en desarrollo (`STORAGE_DIR`); en la nube, S3 con el mismo puerto `ObjectStorage`.

## Consentimiento (E04-S09)

- El primer mensaje del cliente registra el consentimiento (`mensaje_entrante`) con fecha.
- Si el mensaje completo es **BAJA**, **STOP**, **CANCELAR**, **NO MÁS** o **DESUSCRIBIR**, se registra la baja,
  se confirma por WhatsApp y se bloquean las plantillas para ese contacto. Las respuestas dentro de la ventana
  de 24 horas siguen permitidas (atención al cliente).
- **ALTA**, **START** o **SUSCRIBIR** revierten la baja.
- Una frase que solo contiene la palabra ("¿me das de baja el pedido?") NO cuenta como baja.

## Fuera de horario (E04-S10)

Si está activado, el primer mensaje que llega fuera del horario laboral (zona horaria de la empresa) recibe
la respuesta automática. No se repite en la misma conversación hasta que responda una persona.
