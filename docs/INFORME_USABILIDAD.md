# Informe de usabilidad — PreztiaOS (cliente Expo iOS / Android / Web)

> **Fecha:** 2026-11-08 · **Estado:** borrador para discusión (sin commit).
> **Alcance:** `apps/mobile` (Expo Router + NativeWind) y el design system `@preztiaos/ui`; se consultaron contratos (`packages/contracts`), dominio (`packages/domain`) y controladores (`apps/api`) solo para verificar comportamientos que la UI expone.
> **Método:** evaluación heurística por inspección completa del código (heurísticas de Nielsen + criterios de trabajo de campo y de producto financiero), recorridos de tarea con conteo de interacciones y verificación cruzada de cada hallazgo contra el código. **No** incluye pruebas con usuarios ni renderizado en vivo: donde se afirma algo sobre el comportamiento en pantalla, se cita el código que lo produce.
> **Convención de rutas:** relativas a `apps/mobile/src` salvo que empiecen por `packages/` o `apps/api/`.

---

## Estado de ejecución (2026-11-08)

| Fase | Estado | Detalle |
|---|---|---|
| Fase 0 | ✅ Hecha y en producción | ADR #50. Críticos cerrados: C2 (MoneyInput), C3 (clave por intento, cola observable, avisos), C4 (toasts), C5 (sin mock), C9 (confirmaciones), C10 (Idempotency-Key en otorgar/migrar/aprobar/parada). Parcial: C6 (fecha visible y seleccionable en el reporte). |
| Fase 1 | ✅ Hecha (pendiente de desplegar) | ADR #51. Críticos cerrados: C1 ("Mis cobros de hoy" + cobrar es un gesto: abono liquida la parada y registra la visita), C6 ("hoy" en TZ del tenant en reporte, panel, cuentas y pagos), C7 (refresco de sesión), C8 (asignación por deltas), C3 completo (fallidas visibles con reintentar/descartar). Altos cerrados: A1 (panel Hoy + Pendientes), A5 (búsqueda `q` y filtros en servidor, paginación de Clientes y pickers). |
| Fase 2 | ✅ Hecha (pendiente de desplegar) | ADR #52. Cerrados: A2 (glosario y segmentos de Dinero con descripción; Entregas con filtros y totales), A4 (checklist de puesta en marcha), A6 (cotización en vivo, filas de solicitud con nombre/monto/zona/antigüedad, expediente con resumen y dos columnas, zona por nombre), A7 (pt-BR completo + selector de idioma + locale de dinero), A8 (`formatDate*` y `DateField` en toda la app), A9 (un solo detalle de crédito; "Nuevo crédito" desde Clientes), A10 (comprobante dentro de aprobar gasto / verificar depósito), A11 (restablecer y cambiar contraseña, nombre visible, zonas por casillas, planes editables, zonas renombrables, guarda de cambios sin guardar), A12 (`Field` con etiqueta asociada), M9 (`DataTable` con columna fija y totales), M13 (nombre del cobrador en vez del correo). Queda fuera: unificar los read-models de "caja" en un solo modelo de tesorería (las cifras ya se etiquetan por clase en Inicio). |

---

## 1. Veredicto

La base técnica del cliente es sólida: navegación por rol con pocas pestañas, contratos compartidos, dinero en unidades menores, idempotencia en el abono en efectivo, cola offline, botones de ≥44 px, errores de dominio traducidos a mensajes accionables. Sin embargo, **hoy la aplicación no es intuitiva ni fácil de manejar para sus dos usuarios clave**, por razones que no son estéticas sino de flujo y de confianza:

1. **El cobrador no puede hacer su trabajo diario desde la app.** Solo puede registrar un abono a clientes con mora ≥ umbral (3 cuotas por defecto) o a paradas que el coordinador le despache ese día. Para el cliente al día, que es el caso dominante del gota a gota, **no existe ningún camino en la interfaz** (C1).
2. **La captura de dinero es frágil.** `Number("20.000")` registra $20 en silencio; un monto con coma o vacío se convierte en 0 y el servidor lo acepta (un arqueo o la recepción de una rendición con 0 convierte todo el efectivo del cobrador en deuda); los mensajes de validación salen en inglés (C2).
3. **El sistema no confirma ni avisa.** No existe toast/snackbar; el éxito se infiere de que la pantalla "vuelve"; en web `Alert.alert` no hace nada, así que nueve acciones no informan ni éxito ni error (C4); tras encolar un abono sin señal el formulario sigue activo y un segundo toque produce un doble abono (C3).
4. **Las cifras no son confiables para el dueño.** El panel de Inicio pinta **datos de prueba** mientras carga (C5); el "hoy" del reporte diario y del panel se calcula en UTC, así que en Colombia el día "se vacía" a las 19:00 (C6); hay cuatro cifras distintas llamadas "caja" en cuatro pantallas (A2).
5. **El lenguaje es contable y de desarrollador.** "Liquidación / Rendiciones / Consignaciones / Arqueo", "Monto en unidades mayores", "20 = 20%", UUIDs y paths ltree a la vista, "phone_number_id", roles en crudo. Un dueño de negocio no contador no encuentra "cuánto me entregaron hoy".

El resto del informe detalla los hallazgos (10 críticos, 12 altos, ~40 medios/bajos agrupados), los recorridos de tarea y un plan priorizado en tres fases.

---

## 2. Lo que está bien hecho (conservar)

- **Shell responsivo por rol**: ≤5 grupos de navegación; el COLLECTOR ve un perfil enfocado (Inicio · Visitas · Mi caja · Clientes); Ajustes no se ofrece a quien no tiene secciones (`components/app-shell/use-nav-groups.ts`).
- **Botón atrás con fallback** para carga directa de URL en web (`app/(app)/_layout.tsx:69-82`).
- **Estado de pestaña/segmento en la URL** (`?tab=`): recargable y compartible (Ajustes, Dinero, Clientes).
- **Accesibilidad estructural**: hit targets ≥44 px en `Button`, `accessibilityRole`/`accessibilityState` en tabs y chips, `role=alert` y live region en errores de campo, `Modal` que se cierra con backdrop, ✕ y botón atrás de Android.
- **Idempotencia y offline en el abono en efectivo**: una clave por operación reutilizada en los reintentos; `capturedAt` real (`features/payments/api/queries.ts:140-174`, `core/offline/queue.ts`).
- **Errores de dominio con mensaje propio**: 60+ códigos mapeados a textos accionables (`core/errors/index.ts`); `correlationId` visible en el login.
- **Maker-checker** con motivo obligatorio en gastos, consignaciones, rechazos y objeciones; botones con `loading` que evitan el doble clic.
- **Alta "buscar o crear"** idempotente desde OCR en la aprobación (reusa el cliente ante 409); plan por defecto que pre-llena términos; aviso de saldo insuficiente antes de enviar.
- **Confirmación "escribe el nombre"** para borrar/purgar un tenant; desvincular Telegram en dos pasos; secretos nunca devueltos (solo badge "Configurado").
- **Gráficos accesibles** en donut, línea de tiempo y tendencia (leyendas con texto, valor y porcentaje; línea de cero).
- **Tono consistente** (tuteo; 0 "usted").

---

## 3. Hallazgos críticos

Ordenados por impacto en dinero, confianza y frecuencia de uso.

### C1. El cobrador no tiene camino para cobrar al cliente al día
- **Heurística:** correspondencia con el mundo real; flexibilidad y eficiencia.
- **Evidencia:** la lista de Visitas usa `needsVisit` (`overdueCount ≥ threshold`, umbral por defecto 3; `apps/api/src/collections/visit-targets.repository.ts`, `packages/domain/src/credit/collection/visit-policy.ts:27-32`). "Mis clientes" (`features/clients/screens/my-clients-screen.tsx:72-85`) lista filas sin `onPress` y con la única acción "Proponer cambio"; el contrato `collectorClient` no trae `creditId` ni saldo (`packages/contracts/src/collectors.ts:30-35`). Cartera está oculta para el rol. Las únicas entradas a `/payment/` son el detalle de visita (`features/collections/screens/visit-detail-screen.tsx:133`) y pantallas que el cobrador no alcanza. El backend sí autoriza el abono a cualquier crédito de su cartera (`apps/api/src/payments/collector-credit-scope.reader.ts`).
- **Impacto:** el efectivo entra al bolsillo sin asiento, descuadres en la rendición, vuelta al papel/WhatsApp.
- **Recomendación:** convertir "Clientes" en la lista operativa del día (crédito activo, cuota de hoy, saldo, semáforo de mora, buscador, botón "Cobrar"); ampliar `listMyClients` o crear un read-model `GET /me/collection-today`.

### C2. Captura de montos sin protección y mensajes de validación en inglés
- **Heurística:** prevención de errores; ayuda a reconocer y recuperarse de errores.
- **Evidencia:** `majorToMinor(Number(amount))` en `features/payments/screens/register-payment-screen.tsx:50` → `Number("20.000") = 20` pasa la validación (entero positivo) y se registra $20. `Number(x) || 0` en `features/cash/components/cash-count-modal.tsx:63` (arqueo sellado append-only), `features/remittances/screens/remittances-board-screen.tsx:170,205,228` (recepción con 0: el campo destino se oculta, el botón queda habilitado y todo el efectivo pasa a deuda del cobrador), `verify/issue/report-deposit-modal`, `expense-request-form.tsx:25`, `my-cash-screen.tsx:121`, `grant-credit-screen.tsx:129-130`, `decision-modal.tsx:149-150`, `migrate-credit-screen.tsx:77,83`. Los contratos aceptan 0 (`packages/contracts/src/remittances.ts:98`, `cash-boxes.ts:338` `nonnegative()`). Mensajes zod crudos: `registerCashPaymentInput` usa `.positive()` sin `message` (`packages/contracts/src/payments.ts:172`) y la UI muestra `parsed.error.issues[0].message` → "Number must be greater than 0" / "Expected number, received nan"; igual en `my-cash-screen`, `QuickCreateBorrowerModal`, `BorrowerFormModal`, `decision-modal`; `loginInput` → "Invalid email". Solo 17 `message:` en todo `packages/contracts`; no hay `z.setErrorMap`.
- **Impacto:** pérdida financiera directa o deuda falsa al cobrador con un solo toque; errores ilegibles.
- **Recomendación:** `MoneyInput` en `@preztiaos/ui` que parsee el locale (quita separadores de miles, acepta coma), rechace `NaN` con error inline, muestre el valor formateado ("= $ 20.000") y exija confirmación explícita si el monto es 0 o hay faltante; `z.setErrorMap` en español/pt-BR al arrancar.

### C3. Doble abono tras encolar sin señal; rechazos descartados en silencio; cola que solo se vacía al arrancar
- **Heurística:** prevención de errores; visibilidad del estado del sistema; confiabilidad.
- **Evidencia:** tras `queued` el formulario solo muestra un banner y conserva monto y botón activos (`register-payment-screen.tsx:67-69,99-105`); `useRegisterCashPayment` genera `newIdempotencyKey()` **por cada `mutate`** (`features/payments/api/queries.ts:144`); la cola no deduplica (`core/offline/queue.ts:54-72`). Los 4xx se descartan con solo `logger.error` (`queue.ts:114-117`) y la UI solo expone `pendingCount()`; el banner global dice "N pendiente(s)" sin detalle. En nativo el `flush` se dispara solo al montar (`core/offline/use-offline-sync.ts:22-30`; el listener `online` es solo web) y el contador no se actualiza al encolar.
- **Impacto:** segundo toque "por si acaso" = dos abonos al reconectar; abonos que el cobrador cree registrados nunca existieron y el faltante se le atribuye; un cobro de las 9:00 se envía al reiniciar la app.
- **Recomendación:** una clave de idempotencia por sesión del formulario; tras encolar, cerrar con aviso "Guardado sin señal, se enviará solo"; `flush()` en `AppState` activo y tras cada `enqueue`; sección "Pendientes de envío" por cliente con estado pendiente/fallido + motivo + reintentar; nunca descartar un 4xx sin registro visible.

### C4. `Alert.alert` es un no-op en web: nueve acciones sin ninguna respuesta
- **Heurística:** visibilidad del estado; ayuda a reconocer errores.
- **Evidencia:** `node_modules/react-native-web/dist/exports/Alert/index.js` → `static alert() {}`. Usos: `features/applications-review/components/documents-table.tsx:56-62` y `document-viewer.tsx:38-44` (reintento de lectura IA), `features/collections/components/whatsapp-reminder-button.tsx:53-57` (resultado y error del recordatorio, montado por fila en Cartera), `features/collections/screens/collection-map-screen.tsx:116-132` (permiso de ubicación, ruta). Todos con texto hardcodeado.
- **Impacto:** en la plataforma principal del admin, "Enviar recordatorio" y "Reintentar lectura" no muestran nada → pulsaciones repetidas (coste de IA, mensajes al cliente).
- **Recomendación:** `Toast`/`Banner` transversal en `@preztiaos/ui`; prohibir `Alert` por lint; confirmación ligera antes de enviar un mensaje al cliente.

### C5. El panel de Inicio pinta datos de prueba como si fueran reales
- **Heurística:** correspondencia con el mundo real; confianza.
- **Evidencia:** `features/dashboard/api/queries.ts:21` `placeholderData: mockDashboardKpis` (`features/dashboard/data/mock.ts`: $4.850.000 en caja, $32.400.000 de cartera, 128 aprobadas, 23 fraudes). El spinner nunca aparece porque `kpis` ya es el mock (`dashboard-screen.tsx:65-66`); `isPlaceholderData` no se usa.
- **Impacto:** con red lenta o al primer arranque el dueño ve cifras falsas que luego "saltan"; en una pantalla de dinero destruye la confianza.
- **Recomendación:** quitar `placeholderData` y usar `Skeleton` (ya existe en `packages/ui/src/components/skeleton.tsx`).

### C6. El "hoy" del reporte diario, del panel y de los filtros se calcula en UTC
- **Heurística:** correspondencia con el mundo real; visibilidad.
- **Evidencia:** `apps/api/src/cash/cash.controller.ts:189-191` `new Date().toISOString().slice(0,10)`; `cash-query.repository.ts:306-307` límites `T00:00:00Z`; `apps/api/src/dashboard/dashboard-query.repository.ts:208-210`. El cliente pide el reporte sin fecha y **no muestra qué día cubre** (`features/cash/screens/cash-screen.tsx:112-128`); los filtros de Movimientos añaden sufijo `Z` (`cash-movements-screen.tsx:41-48`). Contradice ADR #46 (la zona horaria de la empresa es la única fuente del "hoy").
- **Impacto:** en Colombia desde las 19:00 el "Reporte diario" muestra "Total cobrado $ 0,00", justo cuando el dueño cierra el día.
- **Recomendación:** mostrar siempre la fecha del reporte y permitir elegirla (el contrato ya acepta `date`); resolver el día en el servidor con la TZ del tenant.

### C7. La sesión caduca a los 15 minutos sin refresco y expulsa al usuario en silencio
- **Heurística:** control y libertad; visibilidad.
- **Evidencia:** TTL de acceso 15 min (`apps/api/src/auth/jwt.ts:19`); el cliente guarda el `refreshToken` (`core/auth/token-storage*.ts`) pero **ningún archivo llama a `api.refresh`**; todo 401 → `signOut()` (`core/api/fetcher.ts:60`, `core/auth/session.tsx:72-76`) → `Stack.Protected` desmonta el área autenticada. El texto "Tu sesión expiró" (`core/i18n/index.ts:1293`) nunca se muestra en este camino.
- **Impacto:** un admin que tarda más de 15 min configurando o un cobrador a medio abono pierde el formulario y aparece en el login sin explicación.
- **Recomendación:** interceptor 401 → `refresh` → reintento único (o refresco proactivo antes de `exp`); `signOut("expired")` con banner en el login.

### C8. "Asignar clientes" reemplaza la cartera con lo cargado y desasigna en silencio
- **Evidencia:** `features/collectors/screens/assign-clients-screen.tsx:24-25,36-39,49-52` (el propio comentario: "se REEMPLAZA la cartera con lo seleccionado de las páginas cargadas"; paginación infinita).
- **Impacto:** con más de una página, los clientes no visitados por scroll quedan sin cobrador.
- **Recomendación:** enviar deltas (añadir/quitar) o cargar todo antes de guardar; contador "N seleccionados" y aviso si hay páginas sin cargar.

### C9. Acciones destructivas o irreversibles sin confirmación
- **Evidencia:** eliminar zona (`features/zones/screens/zones-screen.tsx:66-71`), número de WhatsApp con sus credenciales (`zone-whatsapp-editor.tsx:250-255`), plan (`payment-plans-screen.tsx:96-99,148-156`), caja y cuenta (`cash-config-screen.tsx:122,607`), lista (`lists-screen.tsx:63`, además sin `onError`); **tocar la fila de un usuario lo (des)activa** (`users-screen.tsx:66-69`); sellos financieros sin resumen previo: arqueo (`cash-count-modal.tsx:153-158`), ajuste al arqueo (`:132-139`), cerrar período sin decir qué fechas (`settlements-screen.tsx:75-86`), recepción con faltante, condonación (`remittances-board-screen.tsx:283-289`).
- **Recomendación:** `ConfirmModal` único en `@preztiaos/ui` con resumen ("Vas a cerrar 1 oct – 31 oct; no se puede deshacer"); fila de usuario → detalle con Switch explícito.

### C10. Mutaciones de dinero sin clave de idempotencia
- **Evidencia:** el fetcher la soporta y los pagos la usan, pero no otorgar/migrar (`features/credit/api/queries.ts:16-23,46-57`), aprobar solicitud (`features/applications-review/api/queries.ts`) ni liquidar parada (`features/collection-routes/api/queries.ts:92-103`, que registra un pago en `apps/api/src/collections/collection-route.repository.ts:150-160`); el interceptor deja pasar sin clave (`apps/api/src/observability/idempotency.interceptor.ts:43`). Liquidar parada tampoco se encola sin señal.
- **Impacto:** timeout + reintento manual = doble desembolso / doble abono. Además hay **dos vías para el mismo cobro** (abono desde el detalle de visita y "Pagó" en la parada con monto prellenado).
- **Recomendación:** `withRequestOptions({ idempotencyKey })` con clave estable por intento de formulario; un solo gesto "Cobrar" que resuelva abono + parada + visita.

---

## 4. Hallazgos altos

### A1. Inicio no responde "¿cómo va el negocio hoy?"
KPIs de stock (efectivo total, cartera activa, mora) sin "cobrado hoy vs esperado", prestado, gastos por aprobar, rendiciones por recibir ni consignaciones por verificar (`features/dashboard/screens/dashboard-screen.tsx`). El `PeriodToggle` parece global pero solo afecta "Tiempos de atención" (`:198-206`). El gráfico "Comparativa financiera" compara magnitudes no comparables. Emojis como iconos (💰📊⚠️🛡️🚨). "Efectivo en cajas" suma también bancos y tránsito. Valores truncados en móvil (`kpi-card.tsx:79` `adjustsFontSizeToFit`, no implementado en RNW). Sin acciones rápidas ("Otorgar", "Registrar pago"). **Recomendación:** fila "Hoy" (cobrado vs esperado, prestado, gastos, efectivo en oficina / en ruta / bancos) + fila "Pendientes" con contadores accionables; bajar embudo y fraude.

### A2. El modelo mental de "Dinero" es contable, no de dueño de negocio
Seis segmentos (Liquidación / Resumen / Cajas y cuentas / Movimientos / Rendiciones / Consignaciones) que abren por defecto en la pantalla más pesada (`dinero-hub-screen.tsx:63`); en móvil los últimos chips quedan fuera de pantalla sin indicador (`:68 showsHorizontalScrollIndicator={false}`; igual en Clientes y en las 8 pestañas de Ajustes). **Cuatro cifras distintas llamadas "caja"**: "Efectivo en cajas" (Inicio, Σ todas incl. BANK/TRANSIT), "Liquidez total" (Dinero, CASH+BANK), "Caja actual" (Clientes → Operación → Panel, otro read-model) y "Caja del día" (cobrado − prestado − gastos). "Liquidar" significa cierre de período, liquidar visita y liquidada diaria del legado. "Caja menor" se usa para la caja de ruta y la de oficina. **Recomendación:** abrir en "Resumen"; glosario único; renombrar con lenguaje llano + subtítulo ("Entregas de cobradores", "Depósitos al banco", "Cierre de período"); un solo read-model de tesorería.

### A3. La pantalla "Registrar pago" no da contexto, no prellena, no confirma
Solo título, banners, Monto y botón (`register-payment-screen.tsx:76-107`): sin nombre del cliente, cuota de hoy ni saldo; monto vacío (el API ya conoce la cuota); hint "Monto en unidades mayores" (`:88`, jerga). Éxito = `router.back()` sin saldo nuevo aunque el API devuelve `balanceMinor`. Marcar la visita exige escribir una observación incluso tras cobrar (`visit-detail-screen.tsx:61-66,162`) y el banner "Visita registrada" nunca se ve (`setMarked(true)` + `router.back()` en el mismo tick). El teléfono del cliente es texto plano (vs "Llamar" en Mi ruta). **Recomendación:** tarjeta superior con cliente, cuota, saldo; monto prellenado + chips (cuota, ½ cuota, saldo); éxito con "Saldo restante" y "Enviar comprobante"; marcar visita automáticamente al cobrar; chips de observación rápida.

### A4. Onboarding inexistente y callejones sin salida
El tenant nace vacío (`packages/application/src/iam/tenants.ts:28-38,93-100`: sin zona, caja, plan ni usuarios); Inicio no tiene estado vacío ni checklist; la pestaña Zonas es la 7.ª de 8 píldoras con scroll oculto; "Cajas" muestra `EmptyState` **sin acción** (`cash-boxes-screen.tsx:114`); los prerequisitos aparecen al final del embudo, en "Otorgar": "Elige primero la zona", "No hay cajas ni cuentas disponibles" (sin enlace), "No hay planes de pago activos… pide al administrador". ≈30 interacciones y 5 pantallas hasta el primer crédito. **Recomendación:** checklist de puesta en marcha en Inicio para ADMIN (zona, caja + capital inicial, plan, usuarios, caja de ruta) con CTA directo; EmptyState con "Crear caja"; avisos de prerequisito enlazados a Ajustes.

### A5. Las listas no sirven para encontrar
Clientes no pagina (`features/borrowers/api/queries.ts:21-39`: `useQuery`, página 1, 20 ítems) y los pickers de deudor igual, sin aviso de "hay más". El placeholder promete "Buscar por nombre o cédula" (`core/i18n/index.ts:44`) pero solo se envía `name` y el servidor filtra solo nombre + apellido (`apps/api/src/borrowers/borrowers-query.repository.ts:27-34`). Cartera solo busca por nombre aunque el hook soporta `nationalId`/`phone`; filtros Activos/Pagados se aplican **en cliente sobre las páginas cargadas** (`portfolio-screen.tsx:64-69`) → "Aún no hay cuentas" con datos existentes; sin debounce. Selectores de cobrador cargan solo 20 (`cash-movements-screen.tsx:85`, `cash-config-screen.tsx`, `collection-routes-screen.tsx:73`). Rendiciones: único filtro "Solo con deuda" y el servidor ordena los "por recibir" al **final** (`apps/api/src/cash/remittance-query.repository.ts:146`). **Recomendación:** un campo "nombre, cédula o teléfono" (o `q` OR en el contrato); filtro `status` en servidor; paginación infinita con conteo; chips Por recibir / Atrasados / Al día.

### A6. Decisiones de crédito a ciegas
Sin vista previa de valor de cuota, total a pagar ni fecha fin antes de "Otorgar" ni de "Aprobar" (`grant-credit-screen.tsx`, `decision-modal.tsx`); el interés se captura con hint "20 = 20%". En la aprobación la zona se muestra como **UUID** (`decision-modal.tsx:221-223`). La fila de solicitud es "teléfono enmascarado + N doc · M marcados" sin nombre, monto, zona ni antigüedad (`applications-review-screen.tsx:107-120`); sin búsqueda; orden fijo. El expediente es una columna única ≤880 px con los botones de decisión al final (`application-review-detail-screen.tsx:139-156`). El `DecisionModal` conserva el motivo entre "rechazar" y "aprobar" (`decision-modal.tsx:100-108,205-208`) → auditoría errónea. **Recomendación:** cotización del cronograma (helper puro compartido con `buildSchedule` o `POST /credits/quote`) sobre el botón; nombre de zona; resumen enriquecido en la fila; cabecera-resumen con barra de decisión fija y dos columnas en escritorio; `key={mode}` en el modal.

### A7. Idioma: pt-BR es un stub autodetectado y hay ~130 cadenas fuera de i18n
`es` = 1 230 claves, `pt-BR` = 10 (99,2 % faltante) y `detectLocale()` lo activa por el dispositivo (`core/i18n/index.ts:1378-1386`); `setLocale` nunca se llama; `useT` no es reactivo; no hay selector. Resultado: un operador brasileño ve "Entrar / Senha / Início" y el resto en español. Cadenas hardcodeadas: 130 en 32 archivos (listado en el apéndice) + 4 en primitivas de `@preztiaos/ui` ("Reintentar", "Cerrar", "Seleccionar…", "Algo salió mal") que no se pueden localizar. `formatMoney` fija `es-CO` también para BRL ("BRL 1.500,00"); la fecha de Inicio fija `es-CO`. **Recomendación:** default `es` hasta completar pt-BR (o selector + `useT` reactivo); primitivas con textos por prop; `MoneyText`/fechas con locale del tenant.

### A8. Fechas: ISO crudo, "MM-DD" ambiguo, hora del dispositivo, texto libre
`inst.dueDate` "2026-11-08" tal cual (`credit-portfolio-screen.tsx:72`, `account-detail-screen.tsx:70-71`); celdas del cronograma con `dueDate.slice(5)` → "11-08", que un lector hispano lee como 11 de agosto (`account-detail-screen.tsx:85`; igual `settlements-screen.tsx:115`); 30+ `toLocaleString()` sin opciones (con segundos, formato del navegador, sin la TZ de la empresa); fechas de negocio y promesas de pago como texto "AAAA-MM-DD" sin selector ni validación en vivo (`resolve-stop-modal.tsx:79`, `payment-date-field.tsx`, `migrate-credit-screen.tsx:130,140`, `cash-movements-screen.tsx:108-129`, `report-deposit-modal.tsx:72` "AAAA-MM-DD HH:MM"). **Recomendación:** `formatDate/formatDateTime(iso, {locale, tz})` y `DateField` (web `<input type=date>`, nativo picker) en `@preztiaos/ui`; formatos cortos ("hoy 14:05", "1 oct – 31 oct").

### A9. Rutas y pantallas duplicadas o sin salida
Dos detalles para el mismo crédito: `/account/[creditId]` (desde Cartera; cuadrícula de cuotas por color **sin leyenda**) y `/credit/[id]` (tras otorgar/aprobar; título "Créditos"). Rutas modales `credit/new`, `credit/migrate`, `payment/[creditId]` sin `HeaderBack` ni "Cancelar" → sin salida al cargar la URL en web (`app/(app)/_layout.tsx:44-47`). `visit/[creditId]` no está registrada en el Stack (título por defecto, sin fallback) y depende de la query string para nombre/saldo (en recarga muestra "a1b2c3d4"); además dispara `useCreditCollection`, que el servidor rechaza con 403 para el cobrador (`apps/api/src/collections/collections.controller.ts:121-128`). El segmento "Pagos" se ofrece al cobrador (`cuentas-hub-screen.tsx:39-41`) y termina en "No tienes permiso" (`payments-hub-screen.tsx:97-103`). `credit-list-screen.tsx` y `accounts-list-screen.tsx` son código muerto que diverge.

### A10. Estados del sistema incompletos
Errores mostrados como vacíos ("No hay gastos", "No hay órdenes", "Aún no tienes clientes asignados") en `expenses-panel.tsx:50-51`, `deposit-orders-panel.tsx:64-65`, `remittances-board-screen.tsx:59-62`, `my-clients-screen.tsx:46-69`, `my-route-section.tsx:48-49`; otros errores siempre dicen "No hay conexión" sin reintento. Sin `RefreshControl` (0 usos) ni `KeyboardAvoidingView` (0 usos: en iOS el teclado tapa fecha, observación y nota). Botones deshabilitados sin explicación (`expense-review-modal.tsx:85-91`: la clave `cash.expenses.needPaidFrom` existe y nunca se renderiza; `issue-deposit-modal.tsx:89`; `commission-pay-modal.tsx:95`). Comprobante fuera del modal al aprobar gasto / verificar consignación (8 clics, comprobante nunca a la vista).

### A11. IAM del tenant incompleto
Nadie dentro del tenant puede restablecer la contraseña de un cobrador (`updateUserInput` solo `zonePaths`/`active`, `packages/contracts/src/iam-users.ts:46-53`); login sin "olvidé mi contraseña"; "Cambiar clave" deshabilitado con "Próximamente". Zonas de usuario como paths ltree a mano (`users-screen.tsx:153` hint "co.antioquia, co.antioquia.medellin") sin edición posterior; rol en crudo "COLLECTOR". Planes no editables (solo activar/por defecto/eliminar). Sin guardas de cambios sin guardar (grep `beforeunload|usePreventRemove|isDirty` = 0); cambiar de pestaña en Ajustes descarta el borrador. "Solo lectura" incompleto para COORDINATOR (dos `Select` sin `disabled`, `general-tab.tsx:234-238,291-295`). Sección "Sin efecto todavía" con 3 interruptores visibles.

### A12. Accesibilidad: etiquetas y contraste
`Field` no asocia etiqueta y control (sin `nativeID`/`accessibilityLabelledBy`): **138 de 146 `Input` y 19 de 19 `Switch`** sin nombre para lectores de pantalla; `Select` no expone el nombre del campo. Contraste: `#94a3b8` sobre blanco = 2,56:1 (saludo, fecha y etiquetas KPI), placeholder `#a1a1aa` = 2,56:1, `emerald-600` = 3,77:1 (WCAG AA exige 4,5:1). Glifos como controles ("←", "✕", "▾", "✓", "›") sin etiqueta; 15 `<Image>` sin descripción; emojis leídos por el lector. Chips de 36–40 px por debajo de los 44 px de `Button`.

---

## 5. Hallazgos medios y bajos (agrupados)

**Dinero y formato**
- Montos crudos sin `MoneyText` en ≥12 sitios: `portfolio-screen.tsx:173` ("Hoy: 33333.33"), `cash-screen.tsx:86`, `cash-boxes-screen.tsx:99` (`/100` literal), `deposit-order-card.tsx:70,77`, `remittances-board-screen.tsx:133,219`, `my-cash-screen.tsx:85`, `application-review-detail-screen.tsx:109`, `plan-offer-panel.tsx:116`, `decision-modal.tsx:248`, `borrowers-screen.tsx:157`, `migrate-credit-screen.tsx:151`.
- COP con ",00" en toda la app; `compactMoney` "COP 4.9M" (código ISO, punto decimal, divide por 100 a mano); "20.0%" / "75.0 %" con punto.
- Movimientos: dirección solo por color (sin +/−), sin hora, sin saldo acumulado; CSV solo en Liquidación y solo en web.
- `DataTable` con anchos fijos 170/128 px: 12 períodos = 1 706 px dentro de 880 px; sin columna fija, totales ni cabecera de fecha; histórico limitado a `pages[0]`.
- Inputs numéricos de Ajustes normalizados por tecla (no se puede borrar ni poner decimales).

**Navegación y consistencia**
- Control segmentado reimplementado 6+ veces con alturas distintas (36/40 px) → debería ser `SegmentedControl` en `@preztiaos/ui`.
- Pestañas principales solo texto, sin iconos ni badges de pendientes.
- Cabecera de Cartera con 5 botones en una `Row` sin wrap (desborda en móvil); "Mapa de cobro" hardcodeado.
- Menú de usuario: prefijo de UUID del tenant y "zonas: N"; iniciales derivadas del rol; sin nombre/correo ni nombre de empresa.
- Consignaciones abren en "Todos" mientras Gastos abren en "Pendiente"; chips omiten `SEEN`.
- "Mi caja" es un scroll único con el formulario de gasto siempre expandido.
- `MyRouteSection` duplicada en Inicio y Visitas.
- Historial de pagos de un crédito sin fecha (el contrato trae `paidAt`/`createdAt`) y con "—" como título en pagos en efectivo.
- Rechazos: filas inertes; expediente resuelto sin enlace al crédito creado.

**Lenguaje**
- Jerga técnica: "phone_number_id de WhatsApp o tg:<bot>", `entry.kind`, `e.type` y JSON crudo en pagos, "CRITICA", paths ltree, "tenant" en 9 textos de UI, "en/es/pt" como códigos.
- Terminología mixta: "Deudor" (4) vs "cliente" (79); "clave" vs "contraseña"; pestaña "Clientes" sobre ruta `/cuentas` con segmento "Mis clientes"; "Aún no hay cuentas" bajo "Cartera"; "Registrar pago" / "Registrar abono" / "Monto cobrado"; rendición / entrega / liquidación; dos catálogos de documentos divergentes; voseo "Indicá" en un texto.

**Feedback**
- Mensajes de éxito que nunca se ven (`visit-detail-screen.tsx:87-90`, `my-clients-screen.tsx:128`, `resolve-stop-modal.tsx:38`); "Idioma de atención" se guarda al elegir mientras el resto exige "Guardar"; éxito duplicado arriba y abajo sin autodescartar.
- Errores de aprobación/rechazo pierden el detalle del servidor (`t(messageKey)`), mientras otorgar sí lo muestra.
- Geolocalización del cobrador solo en web (`core/geo/current-position.ts` evita `expo-location` aunque ya es dependencia); `catch` vacío sin feedback.

**Accesibilidad menor**
- `Banner` con `role=alert` también en info/success; texto SVG de 10–11 px; contenedores fijos que recortan al 200 %; título del modal sin `flex-1`/`numberOfLines`.
- Login sin mostrar/ocultar contraseña ni `returnKeyType="go"`; una contraseña errónea dispara `signOut()` + `queryClient.clear()`.
- Inputs de monto sin `autoFocus` ni `selectTextOnFocus` (editar un prellenado obliga a borrar dígito a dígito).

---

## 6. Recorridos de tarea (coste actual)

| Tarea | Rol / dispositivo | Interacciones | Fricción principal |
|---|---|---|---|
| Registrar abono a cliente **en mora ≥ umbral** | Cobrador / teléfono | 5 toques + teclear monto (+3 toques y 2 textos para marcar la visita) | Sin buscador; sin contexto ni prellenado; sin confirmación |
| Registrar abono a cliente **al día** | Cobrador / teléfono | **No existe** | C1 |
| Liquidar parada despachada | Cobrador / teléfono | 2 toques | Depende del coordinador; sin offline ni idempotencia |
| Otorgar crédito a cliente existente | Admin / web | 9–10 clics + 2 textos | Inicio no ofrece acceso; sin vista previa; éxito sin confirmación |
| Revisar y aprobar solicitud | Coordinador / web | 7–8 clics + 1–2 textos | Fila sin datos para priorizar; decisión al final de la página; zona como UUID |
| Ver cobrado hoy + efectivo por caja | Admin / web | 3 clics + scroll | Debería ser 0 clics; única vista conjunta escondida en Clientes → Operación |
| Recibir rendición de un cobrador | Coordinador / teléfono | 6 clics | Chip fuera de pantalla; accionables al final; contado prellenado con lo declarado |
| Verificar consignación | Coordinador / teléfono | 8 clics | Comprobante nunca visible al verificar |
| Configurar empresa hasta el primer crédito | Admin nuevo / web | ≈30 interacciones, 5 pantallas | Sin checklist; 2 callejones sin salida; prerequisitos al final del embudo |

---

## 7. Principios y componentes que faltan (base de las mejoras)

1. **Glosario único** (y aplicarlo a UI, i18n y contratos): Cliente (no deudor), Abono (lo que paga el cliente), Entrega (lo que rinde el cobrador), Mi caja / Caja de oficina / Bancos, Cierre de período (no "liquidación"), Empresa (no tenant), Contraseña (no clave), Visita.
2. **Primitivas que hoy no existen en `@preztiaos/ui`** y cuya ausencia se repite en 10+ pantallas: `MoneyInput` (parseo por locale, vista previa, nunca `NaN`→0), `DateField`, `Toast`/`Snackbar`, `ConfirmModal`, `SegmentedControl` (con wrap/indicador), `formatDate/formatDateTime` con locale y TZ del tenant; `Field` que propague `accessibilityLabel`; `ErrorState`/`Modal`/`Select` con textos por prop.
3. **Patrón único de estados** `Loading / Error(retry) / Empty(CTA) / Data` dentro de `<Screen>`, con pull-to-refresh y `KeyboardAvoidingView`.
4. **Feedback explícito** en toda mutación (toast con el dato que importa: "Abono registrado · saldo $X") y **confirmación con resumen** en toda operación irreversible.
5. **Idioma coherente**: un solo idioma por sesión; i18n reactivo con selector; cero cadenas fuera de `t()` (lint).
6. **"Hoy" de la empresa** como única fuente de fecha en servidor y cliente (ADR #46), y la fecha siempre visible en los reportes.
7. **Inicio orientado a la acción**: "Hoy" + "Pendientes" con contadores, distintos por rol.

---

## 8. Plan priorizado

### Fase 0 — Confianza y dinero (1–2 semanas, cambios acotados)
- Quitar `placeholderData` del panel; `Skeleton` mientras carga (C5).
- Parser de monto local + vista previa formateada + rechazo de `NaN`/0 con confirmación explícita en arqueo, recepción y abono (C2, mitigación); `z.setErrorMap` en español (C2).
- Una clave de idempotencia por sesión de formulario; tras encolar, cerrar con aviso; `flush()` en `AppState` activo y tras `enqueue` (C3). `Idempotency-Key` en otorgar/migrar/aprobar/liquidar parada (C10).
- Reemplazar los 9 `Alert.alert` por `Banner`/toast (C4).
- Confirmación en los 7 borrados, en (des)activar usuario y en los 5 sellos financieros (C9).
- Dinero abre en "Resumen"; mostrar la fecha del reporte diario y permitir elegirla (C6 parcial, A2).
- Default `es` (desactivar autodetección pt-BR) hasta completar el diccionario (A7).
- Segmento "Pagos" solo con `payment:reconcile`; registrar `visit/[creditId]` en el Stack con fallback; quitar la llamada 403 del detalle de visita; `HeaderBack` + "Cancelar" en rutas modales (A9).
- Rama `isError` con reintento en los paneles que hoy muestran vacío (A10).
- `#94a3b8`/placeholder → zinc-500; `success` → emerald-700; `accessibilityLabel` en Switch, "←", "✕" (A12).
- `signOut("expired")` con banner en el login (C7 parcial).

### Fase 1 — El cobrador y el dueño pueden trabajar (3–5 semanas)
- Lista operativa del cobrador ("Mis cobros de hoy": crédito activo, cuota, saldo, semáforo, buscador, botón Cobrar) con read-model `GET /me/collection-today` (C1).
- Pantalla de abono con contexto, prellenado, chips de monto y éxito con saldo; un solo gesto "Cobrar" que resuelva abono + parada + visita, idempotente y encolable (A3, C10).
- Cola offline con estado por operación y UI de pendientes/fallidos por cliente (C3).
- Refresh de sesión con interceptor 401 (C7). Asignación de clientes por deltas (C8).
- Inicio "Hoy" + "Pendientes" calculado en la TZ del tenant; corregir el "hoy" UTC en servidor (A1, C6).
- `MoneyInput`, `DateField`, `Toast`, `ConfirmModal`, `SegmentedControl`, `formatDate` en `@preztiaos/ui` y adopción en las pantallas de dinero (C2, A8).
- Búsqueda unificada (nombre / cédula / teléfono), filtro `status` en servidor, paginación en Clientes y pickers (A5).
- Mover las ~130 cadenas a i18n; primitivas con textos por prop (A7).

### Fase 2 — Modelo mental y escala (trimestre)
- Glosario y unificación de los read-models de "caja"; renombrar segmentos de Dinero; filtros y totales en Rendiciones; comprobante embebido y resumen en aprobaciones (A2, A10).
- Vista previa del cronograma al otorgar/aprobar; resumen enriquecido de solicitudes; expediente a dos columnas con barra de decisión fija (A6).
- Unificar las dos pantallas de detalle de crédito; detalle de cliente con "Nuevo crédito" prellenado (A9).
- Checklist de puesta en marcha para ADMIN; `EmptyState` con acción (A4).
- IAM: contraseña en `updateUserInput`, cambio de clave propia, selector de zonas, edición de planes, guardas de cambios sin guardar (A11).
- `DataTable` v2 (columna fija, anchos fluidos, totales) y contenedor ancho para pantallas de datos; nombre visible del cobrador en los contratos.
- pt-BR completo por prefijos de mayor uso (cash, settlement, config, payment, errors) + selector de idioma; `Field` con etiquetas asociadas (A7, A12).

---

## 9. Cómo medir que mejoró

| Métrica | Hoy | Objetivo |
|---|---|---|
| Toques para registrar un abono (cliente al día) | imposible | ≤ 3 desde Inicio |
| Tiempo de un abono en campo | sin medir | < 10 s |
| Montos registrados con valor sospechoso (< 1 % de la cuota) | sin medir | 0 (bloqueado en UI) |
| Clics para "cobrado hoy + efectivo por caja" | 3 + scroll | 0 (Inicio) |
| Acciones de dinero sin feedback visible | 9 (web) | 0 |
| Cadenas fuera de i18n | ~130 | 0 (lint) |
| Cobertura pt-BR | 0,8 % | 100 % o idioma único |
| Inputs sin etiqueta accesible | 138 / 146 | 0 |
| Pares de color bajo 4,5:1 | 3 | 0 |
| Interacciones hasta el primer crédito (ADMIN nuevo) | ≈30 | ≤ 12 con checklist |

---

## Apéndice — cifras verificadas

- **i18n:** `es` 1 230 claves; `pt-BR` 10; faltan 1 220 (99,2 %). Por prefijo faltante: cash 155, settlement 93, config 73, inbox 70, payment 61, remittance 57, errors 55.
- **Cadenas hardcodeadas:** 130 en 32 archivos de `features/` y `components/` (12 nodos JSX, 44 props literales, ~56 objetos `label:`, 13 mapas `Record`, 9 `Alert.alert`) + 4 en `packages/ui`. Mayores concentraciones: `collection-section.tsx` (completo), `portfolio-map-view.tsx` (17), `collection-map-screen.tsx` (13), `collection-reminder-tab.tsx`, `settings.config.ts`, `credit-status.ts`, `review-status.ts`, `payment-status.ts`, `FREQUENCY_OPTIONS` en `grant-credit-screen.tsx` y `payment-plans-screen.tsx`.
- **Accesibilidad:** 146 `Input` / 8 con `accessibilityLabel`; 19/19 `Switch` sin etiqueta; 15 `<Image>` sin descripción; 2 `Pressable` sin rol; contraste 2,56:1 (`#94a3b8`, `#a1a1aa`), 3,77:1 (`emerald-600`).
- **Patrones ausentes:** `Toast/Snackbar` 0; `RefreshControl` 0; `KeyboardAvoidingView` 0; `beforeunload|usePreventRemove|isDirty` 0; `api.refresh` 0; `setLocale` 0 usos.
- **Fechas:** 30+ `toLocaleString()` sin opciones; 3 `slice(5)` → "MM-DD"; 7 campos de fecha como texto libre.
- **Código muerto que diverge:** `credit-list-screen.tsx`, `accounts-list-screen.tsx`; claves i18n sin uso: `review.filter.inProgress/completed`, `cash.expenses.needPaidFrom`, `cash.boxes.total`, `cash.boxes.withdraw`, `cash.sync.difference`, `settlement.commissions.pending`.
- **Claves de idempotencia:** presentes en abono en efectivo, conciliación y pago de comisión; ausentes en otorgar, migrar, aprobar solicitud y liquidar parada.
