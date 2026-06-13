# Documentación de PreztiaOS

Carpeta de documentación viva del proyecto. Se ajusta conforme se toman decisiones.

## Índice

El conjunto está separado por **propósito** (cada documento enfocado y vivo):

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — *El cómo.* Arquitectura: visión, principios, vistas C4, capas (hexagonal/DDD), multitenancy con RLS, contract-first, infraestructura, build, CI, convenciones, ADRs y deuda técnica.
- **[DESIGN.md](./DESIGN.md)** — *El qué.* Análisis y diseño funcional **validado contra el código**: mapa de bounded contexts y su estado, modelo de dominio por contexto, modelo de datos (tablas/enums/invariantes), máquinas de estado, flujos (WhatsApp/KYC/pagos), catálogo de casos de uso y roadmap.
- **[FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md)** — Arquitectura del cliente Expo (iOS/Android/Web): capas, design system `@preztiaos/ui`, seguridad de cliente, offline.
- **[analisisPlataformas.md](./analisisPlataformas.md)** — *Deep-dive* técnico del antifraude documental (fuentes oficiales, viabilidad, URLs).

## Convenciones de la documentación

- Los **diagramas** usan [Mermaid](https://mermaid.js.org/) (se renderizan en GitHub y en VS Code con la extensión *Markdown Preview Mermaid Support*).
- Las **decisiones de arquitectura** se registran en la tabla ADR de `ARCHITECTURE.md` (§20). Cuando una decisión amerite contexto extenso, se promueve a un archivo propio en `docs/adr/NNNN-titulo.md`.
- El **estado de implementación** (qué está construido) se mantiene en `DESIGN.md`, no en `ARCHITECTURE.md`.
- Mantén actualizada la fecha de “última actualización” del encabezado de cada documento al editarlo.
