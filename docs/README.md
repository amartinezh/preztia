# Documentación de PreztiaOS

Carpeta de documentación viva del proyecto. Se ajusta conforme se toman decisiones.

## Índice

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Documento de arquitectura completo: visión, principios, vistas C4, capas (hexagonal/DDD), multitenancy con RLS, modelo de datos, contract-first, flujos, infraestructura, build, CI, convenciones, roadmap por bounded context, ADRs y deuda técnica. Incluye diagramas (Mermaid).

## Convenciones de la documentación

- Los **diagramas** usan [Mermaid](https://mermaid.js.org/) (se renderizan en GitHub y en VS Code con la extensión *Markdown Preview Mermaid Support*).
- Las **decisiones de arquitectura** se registran en la tabla ADR de `ARCHITECTURE.md` (§19). Cuando una decisión amerite contexto extenso, se promueve a un archivo propio en `docs/adr/NNNN-titulo.md`.
- Mantén actualizada la fecha de “última actualización” del encabezado de cada documento al editarlo.
