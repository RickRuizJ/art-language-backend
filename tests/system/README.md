# Pruebas aisladas de API, seguridad, arranque y navegador

Requieren Node 24 (probado en 24.22.1), npm y puertos locales libres. No usan cuentas o bases de producción.

Desde la raíz del backend:

```sh
npm ci
npm ci --prefix tests/system
npm test -- --runInBand
npm run test:integration
npm run test:security
npm run test:startup
```

Los runners crean bases PGlite temporales: puertos 55433, 55436 y 55439. La prueba de arranque además usa 5012. No ejecutar los scripts de integración directamente: requieren un marcador de entorno que solo suministra el runner. El script general heredado borra el esquema **de su propia base efímera**, nunca debe apuntarse a una base útil.

La prueba de seguridad crea un esquema anterior a las correcciones, datos representativos, membresías duplicadas y notas manuales existentes; después migra y verifica preservación, permisos, recuperación, versiones de sesión, conflictos concurrentes, política automática y exportación. La de arranque comprueba un fallo real de migración por FK y readiness 503.

PGlite ejecuta SQL PostgreSQL, pero no reemplaza validación de concurrencia, SSL, extensiones y carga sobre PostgreSQL/Neon real. Antes de producción, repetir aceptación en una copia autorizada de la base real y comprobar restauración.

## Navegador

1. En la carpeta frontend, instalar dependencias y compilar apuntando a la API local. En PowerShell:

```powershell
npm ci
$env:NEXT_PUBLIC_API_URL='http://localhost:5000/api'
npm run build
```

2. En la raíz del backend:

```sh
npx --prefix tests/system playwright install chromium
```

3. Indicar la carpeta frontend y ejecutar. En PowerShell:

```powershell
$env:FRONTEND_DIR='C:\ruta\al\frontend'
npm run test:browser --prefix tests/system
```

En macOS/Linux: `FRONTEND_DIR=/ruta/al/frontend npm run test:browser --prefix tests/system`.

`E2E_CHROME` permite indicar la ruta de un Chromium ya instalado. La entrega fue verificada con Chromium 141. La versión 134 del viejo runner no soportaba el PDF actual. El runner escucha el frontend en loopback explícito; no expone sus servicios a producción.

Los puertos 3000, 5000 y 55435 deben estar libres. El recorrido incluye PDF completo (crear campos, publicar, asignar, alumno móvil guarda/reanuda/envía, revisión y Analytics) y la interfaz de registro, gestión, contraseña temporal, notas manuales, historial, duplicados, CSV, recuperación y separación de promedios. Resend/Cloudinary son sintéticos; no se envían correos reales. Los resultados y capturas de prueba se generan en results/, excluido de Git y de los ZIP finales.
