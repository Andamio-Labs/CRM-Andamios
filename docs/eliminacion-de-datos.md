# Eliminación de datos (E13-S03, E13-S04)

## Supresión de un titular (Ley 1581)

La supresión la ejecuta un propietario o un admin desde la ficha del contacto, con doble confirmación: hay que escribir el nombre del contacto. Se hace dentro de los 15 días hábiles del reclamo.

| Qué | Qué pasa |
|---|---|
| Contacto | Queda anonimizado ("Titular suprimido"): sin teléfono, correo, notas, etiquetas, campos personalizados ni campaña. |
| Conversaciones, mensajes y archivos | Se borran. Los archivos se eliminan del almacenamiento. |
| Tareas del contacto | Se borran. |
| Negocios | Se conservan para no romper reportes. El nombre del titular se reemplaza en el título, y se borran la descripción, la nota de cierre y los campos personalizados. |
| Historial de consentimiento | Se conserva: es la prueba de cumplimiento que exige la misma ley. |
| Auditoría | Registra quién suprimió y cuándo. Nunca copió los valores personales, solo los nombres de los campos. |

## Eliminación de la empresa

Solo el propietario puede eliminar la empresa, y funciona también si la cuenta está en solo lectura. Necesita dos confirmaciones:

1. Pedir un código de 6 dígitos. Llega por correo, vence en 30 minutos y se bloquea después de 5 intentos fallidos.
2. Confirmar con ese código **y** con el nombre exacto de la empresa.

### Qué se borra en el momento

- **Datos:** todos los de la empresa. `purge_tenant()` borra la organización y todo cae en cascada por `tenant_id`, incluida la auditoría.
- **Archivos:** todos los que están bajo `t/{tenant}/` en el almacenamiento.
- **Usuarios:** los que no pertenecen a otra empresa. Sus sesiones se cierran.
- **Suscripción:** no vuelve a cobrarse.

Queda una sola constancia de plataforma: `tenant_deletions (organization_id, deleted_at)`, sin datos personales.

### Backups (política)

- Los backups se conservan **30 días** y después se borran automáticamente (E15-S04). Cumplido ese plazo, los datos de la empresa eliminada ya no existen en ningún backup.
- Si hay que restaurar un backup anterior a una eliminación, se corre `restore.sh` con `LIVE_DATABASE=<base viva>`. El script lee `tenant_deletions` de la base viva y vuelve a aplicar `purge_tenant()` en la base restaurada, antes de que la app apunte a ella. Así una empresa eliminada no reaparece.
- Los archivos no van en los backups de la base: se borran del almacenamiento en el momento.

### Defensa en profundidad

`purge_tenant(p_tenant)` solo borra la empresa que coincide con `app.tenant_id` de la transacción. Aunque un error de código le pasara otro id, no puede borrar otra empresa.
