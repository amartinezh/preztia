import { config } from "dotenv";
import { resolve } from "node:path";

// La API lee su configuración del .env de la raíz del monorepo (un único .env
// compartido con migraciones, etc.). Esto DEBE importarse antes que cualquier
// módulo que lea process.env en tiempo de carga (p. ej. unit-of-work).
// __dirname queda un nivel bajo apps/api tanto en src/ como en dist/, por eso
// la raíz está siempre tres niveles arriba.
config({ path: resolve(__dirname, "../../../.env") });
