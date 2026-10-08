# Pruebas aisladas de API y navegador

Estas herramientas son exclusivamente de desarrollo; no se importan al iniciar Render.
Requieren Node 22 y una terminal con npm. No utilizan tus cuentas ni la base de producción.

## API: regresión y nueva fase

Desde la raíz del backend:

```sh
npm ci
npm ci --prefix tests/system
npm run test:api --prefix tests/system
```

El runner crea PostgreSQL embebido (PGlite) temporal en memoria, en el puerto local 55433,
y ejecuta los 34 controles existentes más los 40 de la fase interactiva.
Cloudinary se simula. Al terminar se elimina la base temporal.
PGlite no sustituye una prueba de concurrencia contra PostgreSQL/Neon real.

`npm test -- --runInBand` ejecuta las 60 pruebas unitarias y de contratos.

**No ejecutar `scripts/integration-test.js` con una base que contenga información útil:**
ese script original elimina el esquema de la base indicada por `TEST_DATABASE_URL`.
El runner de este directorio le proporciona automáticamente una base temporal aislada.

## Navegador: preparado, pendiente de validación

El flujo automatizado está incluido, pero no pudo ejecutarse en el entorno de entrega:
Chromium abortó con `socket() failed: Operation not permitted` antes de abrir una página.
Por tanto, este script todavía puede necesitar ajustes de selectores al ejecutarlo.

1. Instala las dependencias anteriores.
2. En la raíz del frontend, compila con la API local. En Windows PowerShell:

```powershell
npm ci
$env:NEXT_PUBLIC_API_URL='http://localhost:5000/api'
npm run build
```

3. Desde `backend/tests/system`:

```powershell
npx playwright install chromium
$env:FRONTEND_DIR='C:\ruta\completa\al\frontend'
npm run test:browser
```

En macOS/Linux, las variables se asignan con `export NOMBRE=valor`.
Los puertos 3000, 5000 y 55435 deben estar libres. El script levanta sus propios servicios.
No apuntes esta prueba al sitio público: se diseñó únicamente para localhost.

Recorrido preparado: login profesor, upload PDF, dibujar Text Answer y Teacher Review,
configurar puntos, navegar páginas, guardar, publicar, asignar; login alumno con pantalla
390×844, contestar, guardar, recargar, reanudar, enviar; revisión docente, consulta del
resultado y Analytics. Capturas en `results/`. No se incluyen credenciales reales.

Antes de producción, comprobar también manualmente: las cinco herramientas, mover y
redimensionar, tablet, las cinco políticas de feedback, dos pestañas enviando el mismo
intento, fallos de red, y el flujo original con Cloudinary real (PDF/DOCX/imagen/audio/video,
links genéricos y Google, workbooks, mensajes y builder). El archivo `CAMBIOS.md` distingue
las verificaciones ejecutadas de las pendientes.
