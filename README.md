# Frontend Middleware Service

Vitrina inmobiliaria web para clientes de Habitar Inmobiliaria.

Permite visualizar inmuebles, cambiar su estado (me interesa / descartado), ver visitados y consultar el **Histórico de Inmuebles registrados** con carga diferida (lazy load).

## Características principales

- Visualización de inmuebles por pestañas:
  - `Sin revisar`
  - `Me interesa`
  - `Descartadas`
  - `Visitados`
  - `Histórico de Inmuebles registrados`
- Modal de detalle de inmueble con galería.
- Caché en memoria para detalle de inmuebles.
- Carga diferida del histórico para no sobrecargar la carga inicial.
- Estética responsive (desktop y mobile).

## Tecnologías

- HTML
- CSS
- JavaScript (vanilla)

## Estructura del proyecto

```text
frontend/
  index.html
  pages/
    vitrina.html
  css/
    vitrina/
      vitrina.css
  js/
    vitrina/
      vitrina.js
    shared/
      api-error-handler.js
```

## Requisitos

- Navegador moderno (Chrome, Edge, Firefox, Safari).
- (Opcional) Extensión de servidor estático para desarrollo local.

## Ejecución local

Como es un frontend estático, puedes abrir `frontend/pages/vitrina.html` directamente o servirlo con un servidor local.

Ejemplo con VS Code + Live Server:

1. Abre la carpeta del proyecto.
2. Haz clic derecho sobre `frontend/pages/vitrina.html`.
3. Selecciona **Open with Live Server**.

## Configuración y datos

En `frontend/js/vitrina/vitrina.js` se encuentran constantes de configuración:

- `API_BASE`: endpoint principal de vitrina.
- `DEFAULT_TOKEN`: token por defecto para pruebas.
- `TUNNEL_HEADERS`: encabezado para bypass del túnel.

### Endpoints utilizados

- `GET /api/v1/vitrina/{token}`
- `GET /api/v1/vitrina/{token}/inmuebles/{wasiId}`
- `PATCH /api/v1/vitrina/{token}/estado/aprobar`
- `PATCH /api/v1/vitrina/{token}/estado/descartar`
- `PATCH /api/v1/vitrina/{token}/estado/visitar`
- `GET /api/v1/historico-inmuebles/por-cliente/{token}`

## Comportamiento de histórico

- El histórico **no se carga** al iniciar la vitrina.
- Solo se consulta al entrar por primera vez a la pestaña de histórico.
- Se consolida por `codigoNumerico`, conservando el último estado por fecha.
- Se guarda en memoria para evitar refetch inmediato al reingresar a la pestaña.

## UI/Branding

- Fondo con logo de Habitar Inmobiliaria en gran tamaño y baja opacidad.
- Footer con marca de copyright:
  - `© HabitarInmobiliaria 2026`

## Mejoras futuras sugeridas

- Agregar pruebas E2E para flujos de tabs y histórico.
- Manejo avanzado de errores en histórico (mensajes más detallados).
- Estrategias de caché con expiración temporal.

