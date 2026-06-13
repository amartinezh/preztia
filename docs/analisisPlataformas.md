# VALIDACIÓN DOCUMENTAL ANTIFRAUDE — BRASIL
## Pipeline: Extracción de metadata → Antifraude local → Verificación con APIs libres → (opcional) APIs de pago
### Versión 2.0 — Junio 2026

---

## ALCANCE (3 documentos iniciales del onboarding)

| # | Documento                                   | Variantes aceptadas                          |
|---|---------------------------------------------|----------------------------------------------|
| A | Documento de identidad brasilero            | CNH (física/digital), CIN, RG antiguo, CPF   |
| B | Documento que acredita registro del negocio | Cartão CNPJ, Contrato Social, CCMEI          |
| C | Recibo de servicio público (residencia)     | Conta de luz, agua, teléfono, gas            |

---

## HALLAZGO CLAVE (leer antes de diseñar)

El benchmark académico AIForge-Doc (arXiv 2602.20569, feb/2026) demostró que
GPT-4o como detector de adulteración documental rinde AUC = 0.509 — es decir,
AL AZAR. Las falsificaciones hechas con IA generativa (Gemini Flash Image,
Ideogram) son indistinguibles para los VLMs generalistas.

CONSECUENCIA ARQUITECTÓNICA:
- La IA sirve para EXTRAER campos y CRUZAR datos, NO como juez de autenticidad.
- La autenticidad real solo se obtiene contrastando contra la FUENTE EMISORA
  o con QR criptográfico (eso vive en la etapa de pago, opcional).
- Los recibos de servicios públicos NO tienen fuente emisora consultable:
  máximo alcanzable = score probabilístico (con o sin APIs de pago).

---

# PIPELINE DE VALIDACIÓN (decisión de diseño)

```
  upload ──► ETAPA 1: EXTRACCIÓN ──► ETAPA 2: ANTIFRAUDE LOCAL ──► ETAPA 3: APIs LIBRES ──► score/decisión
                 │ (persistir TODO en BD)        │ ($0, sin red)            │ ($0, red)
                 ▼                               ▼                          ▼
            document_extractions          alertas locales            alertas de cruce
                                                                            │
                                          (futuro, opcional) ETAPA 4: APIs DE PAGO ◄── solo si pasó 1-3
```

### ETAPA 1 — Extracción completa de metadata (persistir en BD)

Todo documento subido se procesa UNA sola vez para extraer y **guardar**:

1. **Metadata técnica del archivo** — ExifTool (open source, $0):
   Producer, Creator, CreateDate, ModifyDate, software de origen, dimensiones,
   tabla de cuantización JPEG, GPS si existe.
2. **Campos del documento** — VLM (Gemini 2.5 Flash; free tier para desarrollo):
   todos los campos visibles según el tipo de documento (ver prompts por
   categoría más abajo), más `tipo_documento`, `legibilidad`, `obstrucciones`.
3. **Hash SHA-256 del archivo original** — detección de re-envíos y evidencia.

Lo persistido es la **fuente única para las etapas 2 y 3**: permite reprocesar
reglas antifraude sin re-extraer, deja evidencia auditable (append-only, con
`tenant_id`) y habilita análisis retrospectivo cuando se agreguen reglas nuevas.

> Nota de costo: Gemini Flash tiene free tier con límites de rate (suficiente
> para desarrollo y volúmenes iniciales); en producción ~USD 0.001–0.01/doc.
> Es el único componente del pipeline 1-3 que no es 100% gratuito a escala.

### ETAPA 2 — Antifraude local avanzado ($0, sin salir a la red, <500ms)

Sobre los datos ya persistidos se corren reglas algorítmicas y forenses:

- **Dígitos verificadores**: CPF/CNPJ mod-11; línea digitable FEBRABAN.
- **Coherencia interna**: fechas (nacimiento < emisión < hoy; validez no
  vencida; mes de referencia vs vencimiento), valor impreso == valor
  codificado en el código de barras, edad >= 18.
- **Forense de archivo**: Producer sospechoso (Photoshop/Canva en documento
  oficial), ModifyDate >> CreateDate, ELA (Error Level Analysis) sobre JPEG
  para regiones re-comprimidas.
- **Coherencia entre documentos del mismo solicitante**: nombre del titular
  del recibo vs identidad; dirección del recibo vs domicilio declarado;
  CPF de la identidad vs QSA del negocio (el cruce contra fuente se completa
  en Etapa 3).

Resultado: lista de alertas `{campo, severidad, detalle}` persistida junto a
la extracción. Mata el 30-40% de los fraudes torpes sin costo.

### ETAPA 3 — Verificación externa con APIs de uso libre ($0)

Cruce de lo extraído contra fuentes públicas gratuitas (detalle por categoría
en la PARTE I): Minha Receita / BrasilAPI CNPJ, BrasilAPI CEP v2 / ViaCEP,
BrasilAPI DDD, validador ITI de firmas ICP-Brasil.

### ETAPA 4 (futura, opcional) — APIs de pago

Solo para autenticidad fuerte contra fuente emisora (SERPRO, Infosimples,
Open Finance, forense comercial). Documentadas al final (PARTE II). **No
bloquean el inicio del desarrollo.**

---

# VEREDICTO: ¿SE PUEDEN HACER LAS 3 VALIDACIONES SOLO CON APIs LIBRES?

| Cat. | Documento            | ¿Viable gratis? | Cobertura | Qué queda fuera sin pagar                          |
|------|----------------------|-----------------|-----------|----------------------------------------------------|
| B    | Registro de negocio  | ✅ SÍ           | ~95-100%  | Casi nada: Minha Receita ES la fuente oficial (RFB). Solo contrato social ante Junta Comercial queda manual/EDD |
| A    | Identidad            | ⚠️ PARCIAL      | ~50-60%   | Confirmar que el CPF pertenece a ese nombre/nacimiento (Serpro), QR de CNH/CIN vs base oficial, biometría |
| C    | Recibo serv. público | ✅ SÍ*          | ~60-70%   | *Nada que el pago resuelva: NO existe fuente emisora consultable; el techo es el mismo con o sin APIs de pago |

**Conclusión operativa:**
- **Negocio (B): 100% resuelto gratis.** Minha Receita devuelve los mismos
  datos de la Receita Federal que cualquier API paga.
- **Recibo (C): el máximo alcanzable se logra gratis** (estructura FEBRABAN +
  CNPJ de la distribuidora + CEP + forense local). Las APIs de pago solo
  agregan un score probabilístico, nunca certeza.
- **Identidad (A): es la única categoría donde el dinero compra algo real.**
  Gratis se valida estructura (mod-11), coherencia y forense; la confirmación
  CPF↔nombre↔nacimiento contra la base RFB requiere Serpro (Etapa 4).
  **Mitigación sin costo para arrancar:** el trial de Serpro Consulta CPF es
  gratuito para desarrollo, y el cruce identidad↔QSA del CNPJ (gratis) ya
  amarra el nombre del solicitante a un registro oficial indirectamente.
- ✅ **Se puede iniciar el desarrollo completo del pipeline (Etapas 1-3) hoy,
  sin contratar nada.** La Etapa 4 se enchufa después como un puerto más.

---

---

# PARTE I — RECURSOS DE USO LIBRE (trabajar con esto YA)

## I.1 — Herramientas locales ($0, sin red)

### Dígito verificador CPF (mod-11)

```javascript
function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(cpf[i]) * (10 - i);
  let d1 = (s * 10) % 11 % 10;
  if (d1 !== parseInt(cpf[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(cpf[i]) * (11 - i);
  let d2 = (s * 10) % 11 % 10;
  return d2 === parseInt(cpf[10]);
}
```
- Detecta: CPFs inventados con dígitos inválidos.
- Equivalente mod-11 para CNPJ (14 dígitos, pesos 5..2/6..2).

### Línea digitable FEBRABAN 48 dígitos (recibos de convenio/arrecadação)

Estructura:
- Posición 1: "8" (identificador de arrecadação)
- Posición 2: segmento (1=prefeitura, 2=saneamento, 3=energía/gas,
  4=telecom, 5=órganos gov...)
- Posición 3: identificador de valor
- Posición 4: dígito verificador general (mod 10 u 11)
- Posiciones 5-15: valor
- Posiciones 16-19/20-23: código de la empresa/convenio
- DV de cada bloque de 12 dígitos: mod 10

```python
def validar_linha_digitavel_convenio(linha: str) -> dict:
    d = linha.replace(" ", "").replace(".", "")
    if len(d) != 48 or d[0] != "8":
        return {"valido": False, "motivo": "estructura"}
    segmento = d[1]   # "3" esperado para energía
    # validar DV de cada uno de los 4 bloques de 12 con módulo 10/11
    # validar que el valor codificado == valor impreso en la factura
    # validar que el código de empresa corresponde a la distribuidora
    ...
```
- Detecta: boletos generados al azar, valores editados (el valor está
  DENTRO del código de barras: si editaron el monto impreso pero no el
  código, hay mismatch).

### ExifTool — forense de metadata (open source)
- URL: https://exiftool.org/
- Corre en Etapa 1 (extracción, se persiste) y alimenta reglas de Etapa 2.

```bash
exiftool -json documento.pdf
# Señales de alerta:
# "Producer": "Adobe Photoshop"  → bandera roja
# ModifyDate muy posterior a CreateDate → bandera amarilla
```

### Error Level Analysis (ELA) — Python open source
- Repos de referencia: github.com/topics/tampering-detection
- Herramienta GUI: Sherloq (github.com/GuidoBartoli/sherloq)
- Detecta: regiones re-editadas en JPEG por diferencias de compresión
  (nombre/dirección/valor sobrescritos).

### Reglas de coherencia de fechas (local)
- Fecha nacimiento < fecha emisión < hoy; edad >= 18 para representante legal.
- CNH: validez no vencida (campo "Validade").
- Recibo: fecha de emisión < 90 días (regla de mercado para comprobante);
  mes de referencia coherente con vencimiento.

## I.2 — Extracción con VLM (free tier para desarrollo)

### Gemini 2.5 Flash (recomendado por costo)
- URL: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
- Free tier: sí, con límites de rate (suficiente para desarrollo)
- Producción: ~USD 0.075 / 1M tokens input (verificar pricing actual)

REQUEST (concepto, identidad):
```bash
curl -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [
        {"inline_data": {"mime_type": "image/jpeg", "data": "<BASE64_CNH>"}},
        {"text": "Extrae en JSON: nome, cpf, data_nascimento, numero_registro,
                  validade, categoria, uf_emissor, nome_pai, nome_mae.
                  Indica también: tipo_documento (cnh_fisica/cnh_digital/cin/rg),
                  legibilidad (alta/media/baja), obstrucciones (true/false).
                  Responde SOLO el JSON."}
      ]
    }]
  }'
```

RESPONSE (ejemplo):
```json
{
  "nome": "JOAO DA SILVA",
  "cpf": "123.456.789-09",
  "data_nascimento": "1985-03-15",
  "numero_registro": "01234567890",
  "validade": "2028-06-20",
  "categoria": "AB",
  "uf_emissor": "SP",
  "tipo_documento": "cnh_fisica",
  "legibilidad": "alta",
  "obstrucciones": false
}
```

Campos a extraer por categoría (mismo patrón de prompt):
- **Negocio**: razao_social, cnpj, qsa[] (nombre + calidad), capital_social,
  NIRE, fechas de constitución/alteración.
- **Recibo**: titular, dirección completa, CEP, CNPJ emisor, fecha de emisión,
  mes de referencia, vencimiento, valor, número de instalación/cliente,
  línea digitable / código de barras.

ADVERTENCIA: el VLM extrae; NUNCA se le pregunta "¿es auténtico?" (AIForge-Doc).

## I.3 — APIs públicas gratuitas (Etapa 3)

### Minha Receita — datos completos del CNPJ ✅ GRATIS (fuente: RFB)
- URL: https://minhareceita.org/{cnpj}
- Docs: https://docs.minhareceita.org/
- Código: https://github.com/cuducos/minha-receita (open source, MIT)
- Costo: $0 — y puedes SELF-HOSTEARLA en tu VPS (recomendado para
  producción: descarga los datos de la RFB y corre tu propia instancia
  sin límites ni dependencia de terceros)
- Sin recolección de datos de tus consultas

REQUEST:
```bash
curl https://minhareceita.org/33683111000280
```

RESPONSE (campos principales):
```json
{
  "cnpj": "33683111000280",
  "razao_social": "SERVICO FEDERAL DE PROCESSAMENTO DE DADOS (SERPRO)",
  "nome_fantasia": "REGIONAL BRASILIA",
  "situacao_cadastral": 2,
  "descricao_situacao_cadastral": "ATIVA",
  "data_inicio_atividade": "1967-06-30",
  "cnae_fiscal": 6204000,
  "cnae_fiscal_descricao": "Consultoria em tecnologia da informação",
  "logradouro": "SETOR DE GRANDES AREAS NORTE QUADRA 601 MODULO V",
  "municipio": "BRASILIA",
  "uf": "DF",
  "cep": "70836900",
  "capital_social": 1061004800.0,
  "porte": "DEMAIS",
  "opcao_pelo_simples": false,
  "opcao_pelo_mei": null,
  "qsa": [
    {
      "nome_socio": "FULANO DE TAL",
      "cnpj_cpf_do_socio": "***123456**",
      "qualificacao_socio": "Presidente",
      "data_entrada_sociedade": "2020-01-15"
    }
  ]
}
```

VALIDACIONES ANTIFRAUDE DERIVADAS (todas gratis):
- situacao_cadastral != ATIVA → rechazo automático
- data_inicio_atividade < 6 meses → escalar a EDD
- CPF del representante NO está en qsa[] → alerta roja (sin poderes)
- cnae_fiscal incoherente con el crédito solicitado → alerta
- cep/uf del documento != cep/uf de la Receita → alerta

Fallbacks gratuitos de la misma fuente:
- **BrasilAPI CNPJ**: https://brasilapi.com.br/api/cnpj/v1/{cnpj}
  (usa Minha Receita por debajo; segunda fuente de disponibilidad)
- **OpenCNPJ**: https://api.opencnpj.org/{cnpj} — docs https://opencnpj.org/
  (extra: datasets descargables + BigQuery para análisis masivo)
- **CNPJá Open**: https://open.cnpja.com/office/{cnpj} — gratis, 5 consultas/min/IP

### BrasilAPI CEP v2 — dirección ✅ GRATIS, sin API key
- URL: https://brasilapi.com.br/api/cep/v2/{cep}
- Docs: https://brasilapi.com.br/docs
- Cache CDN en 23 regiones; devuelve lat/lon (sirve para triangulación GPS)
- Detecta: direcciones inventadas, CEP que no corresponde a la ciudad/UF

REQUEST:
```bash
curl https://brasilapi.com.br/api/cep/v2/01311000
```

RESPONSE:
```json
{
  "cep": "01311000",
  "state": "SP",
  "city": "São Paulo",
  "neighborhood": "Bela Vista",
  "street": "Avenida Paulista",
  "service": "open-cep",
  "location": {
    "type": "Point",
    "coordinates": { "longitude": "-46.654", "latitude": "-23.563" }
  }
}
```

Alternativa: ViaCEP — https://viacep.com.br/ws/{cep}/json/ (también gratis)

### BrasilAPI DDD — teléfono vs estado declarado ✅ GRATIS
- URL: https://brasilapi.com.br/api/ddd/v1/{ddd}

REQUEST:
```bash
curl https://brasilapi.com.br/api/ddd/v1/11
```

RESPONSE:
```json
{
  "state": "SP",
  "cities": ["SÃO PAULO", "GUARULHOS", "OSASCO", "..."]
}
```

### Verificador ITI — firmas digitales ICP-Brasil/GOV.BR en PDF ✅ GRATIS
- Web: https://validar.iti.gov.br/
- Self-host: verificador de la UFSC
- Aplica a: CCMEI y certidões emitidas como PDF firmado digitalmente —
  si la firma valida, el documento es auténtico criptográficamente.

### Redesim — validador oficial de comprobantes (Cartão CNPJ) ✅ GRATIS
- https://www.gov.br/empresas-e-negocios/pt-br/redesim (sección "Validar Comprovantes")

## I.4 — Cómo aplica lo gratis a cada categoría

### Categoría A — Identidad (CNH, CIN, RG, CPF)

| Etapa | Validación gratuita |
|-------|---------------------|
| 1 | Extracción VLM de todos los campos + ExifTool + hash → BD |
| 2 | mod-11 del CPF impreso; coherencia de fechas; validez CNH; ELA/Producer |
| 3 | CEP del domicilio (BrasilAPI/ViaCEP); DDD vs UF; cruce indirecto: ¿el nombre extraído aparece en el qsa[] del CNPJ del negocio? |

Techo gratis: ~50-60%. Lo que falta (CPF↔nombre↔nacimiento contra RFB,
QR CNH/CIN, biometría) está en PARTE II. El trial de Serpro (gratis, datos
ficticios) permite desarrollar el adaptador de Etapa 4 desde ya.

### Categoría B — Registro de negocio (Cartão CNPJ, Contrato Social, CCMEI)

| Etapa | Validación gratuita |
|-------|---------------------|
| 1 | Extracción VLM (razao_social, cnpj, qsa[], capital, NIRE, fechas) + ExifTool → BD |
| 2 | mod-11 del CNPJ; coherencia de fechas; ELA/Producer |
| 3 | **Cruce campo a campo vs Minha Receita** (ver abajo); CEP; firma ICP-Brasil si es PDF firmado (CCMEI); Redesim para cartão CNPJ |

EL CRUCE QUE LO CAMBIA TODO (Etapa 3, gratis):

```python
def cruzar_contrato_vs_receita(extraido: dict, receita: dict) -> list:
    alertas = []
    if normalizar(extraido["razao_social"]) != normalizar(receita["razao_social"]):
        alertas.append({"campo": "razao_social", "severidad": "ALTA"})
    socios_doc = {normalizar(s["nome"]) for s in extraido["qsa"]}
    socios_rfb = {normalizar(s["nome_socio"]) for s in receita["qsa"]}
    faltantes = socios_doc - socios_rfb
    if faltantes:
        alertas.append({"campo": "qsa", "severidad": "CRITICA",
                        "detalle": f"Socios en documento ausentes en RFB: {faltantes}"})
    if abs(extraido["capital_social"] - receita["capital_social"]) > 0.01:
        alertas.append({"campo": "capital_social", "severidad": "MEDIA"})
    return alertas
```

Un contrato social adulterado para inflar capital o agregar un socio falso
CAE AQUÍ, sin pagar ni un centavo de API de autenticidad.

Caso especial — **Cartão CNPJ: autenticidad 100% gratis**: el documento es
una representación de datos públicos → regenerarlo consultando la fuente
(Minha Receita) y comparar TODO equivale a validarlo.

Techo gratis: ~95-100%. Solo el contrato social ante la Junta Comercial
estatal queda como verificación manual en esteira EDD (no hay API nacional,
ni gratis ni paga — ver PARTE II).

### Categoría C — Recibo de servicio público

VERDAD INCÓMODA: NINGUNA distribuidora brasileña (Enel, CPFL, Neoenergia,
Sabesp, Vivo...) expone API pública para validar autenticidad de facturas a
terceros. La validación 100% NO ES POSIBLE en esta categoría — **ni pagando**.
Por eso lo gratis alcanza el mismo techo que lo pago (~60-70%, score de riesgo).

| Etapa | Validación gratuita |
|-------|---------------------|
| 1 | Extracción VLM (titular, dirección, CNPJ emisor, valor, línea digitable, mes ref.) + ExifTool → BD |
| 2 | FEBRABAN 48 dígitos (DV + valor codificado == valor impreso); emisión < 90 días; mes ref. vs vencimiento; ELA/Producer |
| 3 | CNPJ de la distribuidora vs Minha Receita (¿existe? ¿CNAE 3514-0/00 distribución de energía o equivalente? una "factura de luz" emitida por CNAE comercio varejista = fraude); CEP existe y coincide con ciudad/UF de la concesionaria (Enel RJ no factura en Curitiba); titular vs identidad/QSA |

Compensación gratuita adicional (triangulación de dirección):
- GPS del dispositivo durante onboarding vs lat/lon del CEP (BrasilAPI CEP v2).
- Política de producto: peso reducido del comprobante en el score final.

---

---

# PARTE II — APIs DE PAGO (Etapa 4, futura — NO bloquean el desarrollo)

Se integran después como adaptadores de un puerto de verificación externa,
solo para documentos que ya pasaron las Etapas 1-3 (optimización de costo).

## II.1 — Identidad (la categoría donde el pago aporta valor real)

### CPF — SERPRO Consulta CPF ✅ VIABILIDAD 100%
- Contratación: https://loja.serpro.gov.br/consultacpf
- Docs: https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cpf/
- **Trial GRATIS para desarrollo** (datos ficticios) → el adaptador se puede
  construir y probar hoy sin contratar
- Precio estimado producción: ~R$ 0,02 a R$ 0,11 por consulta según volumen
  (confirmar en Loja Serpro; cobro por uso, sin mensualidad mínima alta)
- Valida: nombre completo, nombre social, fecha nacimiento, situación
  cadastral (Regular/Suspensa/Cancelada/Nula/Falecido), directo en base RFB

REQUEST (trial):
```bash
# 1. Obtener token OAuth2
curl -X POST https://gateway.apiserpro.serpro.gov.br/token \
  -H "Authorization: Basic $(echo -n 'CONSUMER_KEY:CONSUMER_SECRET' | base64)" \
  -d "grant_type=client_credentials"

# 2. Consultar CPF
curl https://gateway.apiserpro.serpro.gov.br/consulta-cpf-trial/v1/cpf/40442820135 \
  -H "Authorization: Bearer $TOKEN"
```

RESPONSE:
```json
{
  "ni": "40442820135",
  "nome": "Nome do CPF 404.428.201-35",
  "situacao": { "codigo": "0", "descricao": "Regular" },
  "nascimento": "14111970"
}
```

CRUCE ANTIFRAUDE: comparar nome + nascimento de la respuesta vs lo extraído
en Etapa 1. Mismatch = fraude probable.

### CNH — SERPRO Datavalid (QR Code vs base Senatran) ✅ VIABILIDAD 100%
- Contratación: https://loja.serpro.gov.br/datavalid
- Info: https://campanhas.serpro.gov.br/datavalid/novidades/
- Precio estimado: ~R$ 0,20 a R$ 0,90 por validación según banda de consumo
  (descuento progresivo; confirmar en Loja Serpro)
- Única solución del mercado que: lee el QR de la CNH → decodifica →
  valida contra Senatran → opcionalmente compara selfie (face match +
  liveness) en la misma llamada
- App Datavalid y SDK Bioconnect: gratuitos (solo pagas el consumo API)

REQUEST (concepto, estructura del gateway Serpro):
```bash
curl -X POST \
  "https://gateway.apiserpro.serpro.gov.br/datavalid/v4/validate/cnh-qrcode" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": { "qrcode": "<STRING_DECODIFICADA_DEL_QR>" },
    "answer": {
      "biometria_face": "<BASE64_SELFIE>",
      "vivacidade": true
    }
  }'
```

RESPONSE (concepto):
```json
{
  "qrcode_valido": true,
  "cnh": {
    "numero_registro": "01234567890",
    "nome": "JOAO DA SILVA",
    "cpf": "12345678909",
    "categoria": "AB",
    "validade": "2028-06-20"
  },
  "biometria_face": {
    "disponivel": true,
    "probabilidade": "Altíssima probabilidade",
    "similaridade": 0.9876,
    "vivacidade": { "provavel": true, "score": 0.97 }
  }
}
```

### CIN (nueva Carteira de Identidade Nacional) — Vio-Decoder ✅ 100%
- Contratación: https://loja.serpro.gov.br/vioaplicativo (modalidad API)
- Info: https://www.serpro.gov.br/menu/noticias/noticias-2021/vio-emissao-validacao-de-documentos
- El QR de la CIN solo puede generarse con claves criptográficas custodiadas
  por Serpro en sala-cofre → falsificación de QR = imposible en la práctica
- La CIN usa blockchain b-Cadastros (Serpro + Receita Federal)
- API Vio-Decoder: decodifica el QR y devuelve todos los datos del documento
  incluyendo foto, para comparar contra lo presentado
- Precio: por consumo, contratación en Loja Serpro (estimar ~R$ 0,10-0,50
  por decodificación; confirmar)
- Plan B sin costo: app Vio (manual, funciona offline) para esteira humana

### RG ANTIGUO (modelo estatal sin QR) ⚠️ VIABILIDAD PARCIAL ~70%
- NO existe API pública contra las bases de los institutos estatales de
  identificación
- Mitigación recomendada:
  a) Validar el CPF impreso en el RG vía Consulta CPF
  b) Biometría facial vs base gubernamental vía Datavalid
  c) Política de producto: aceptar RG solo con score reducido y pedir
     CNH/CIN para montos altos

## II.2 — Negocio (complementos pagos, mayormente innecesarios)

### Certidões con código de control ✅ VIABILIDAD 100% (pago bajo)
- CND Federal (PGFN): verificable en
  https://solucoes.receita.fazenda.gov.br/Servicos/certidaointernet/PJ/Consultar
- CNDT (trabalhista): https://cndt-certidao.tst.jus.br/
- CRF/FGTS: https://consulta-crf.caixa.gov.br/
- Todas tienen código de control verificable en el sitio emisor (web, gratis
  manual); automatización vía API comercial: Infosimples
  - URL: https://infosimples.com/consultas/
  - Precio estimado: ~R$ 0,10 a R$ 0,60 por consulta según el tipo

```bash
curl -X POST https://api.infosimples.com/api/v2/consultas/tribunal/tst/cndt \
  -d "token=$TOKEN" \
  -d "cnpj=33683111000280"
```

### CCMEI ⚠️ VIABILIDAD ~90%
- Verificación con código en Portal do Empreendedor (web, sin API oficial):
  https://www.gov.br/empresas-e-negocios/pt-br/empreendedor
- Vía API: scraping propio o Infosimples (pago)

### Contrato Social ⚠️ VIABILIDAD PARCIAL ~75%
- NO hay API nacional unificada de Juntas Comerciales
- JUCESP (São Paulo): registro web manual — https://www.jucesponline.sp.gov.br/
- JUCERJA, JUCEMG, etc.: cada estado su portal
- ESTRATEGIA: el cruce de Etapa 3 (QSA + capital vs RFB, gratis) cubre el 80%
  del riesgo real; consulta manual a la Junta solo en esteira EDD
- Servicios pagos de obtención: ConsultaSoc, EmpresaFácil

### CNPJá comercial — Inscripción Estatal (SINTEGRA/CCC) y SUFRAMA
- Docs: https://cnpja.com/api — planes desde ~R$ 30-100/mes según volumen

## II.3 — Recibos (pago = solo score probabilístico, nunca certeza)

### Forense documental comercial
- Veryfi Fraud Intelligence — https://www.veryfi.com/ai-generated-documents/
  (>100 indicadores, claim de 99.7% sobre IA-generated; precio enterprise,
  trial gratuito de API OCR)
- Resistant AI — https://resistant.ai/ (enterprise, sin precio público)
- Inscribe — https://www.inscribe.ai/ (enterprise)
- DocVerify — https://docverify.app/ (API para developers, pricing por uso)
- Koncile — https://www.koncile.ai/ (OCR + reglas de negocio + anomalías)
- Realidad: ninguna valida contra la base de la distribuidora; entregan
  probabilidad de manipulación

### Triangulación de dirección vía Open Finance (más sólido que el forense)
- Belvo https://belvo.com/ o Pluggy https://pluggy.ai/: la dirección
  registrada en el banco del cliente — dato con KYC bancario detrás
- Precio estimado: ~R$ 0,50-2,00 por consulta de datos cadastrales según
  plan (confirmar)

---

# TABLA FINAL DE CLASIFICACIÓN DE VIABILIDAD

## ✅ GRATIS — desarrollar YA (Etapas 1-3)

| # | Validación                              | API/Herramienta              | Costo  |
|---|------------------------------------------|------------------------------|--------|
| 1 | Extracción de campos + metadata → BD     | Gemini Flash (free tier) + ExifTool | $0 dev / ~USD 0.001-0.01 prod |
| 2 | CPF/CNPJ: dígito verificador             | Algoritmo mod-11 local       | GRATIS |
| 3 | Código de barras boleto/convenio         | Algoritmo FEBRABAN local     | GRATIS |
| 4 | Forense de archivo (Producer/fechas/ELA) | ExifTool + Sherloq/ELA       | GRATIS |
| 5 | CNPJ: existencia/situación/QSA/CNAE      | Minha Receita (self-host)    | GRATIS |
| 6 | Cartão CNPJ: autenticidad por cruce      | Minha Receita + Redesim      | GRATIS |
| 7 | CEP/dirección: existencia y coherencia   | BrasilAPI / ViaCEP           | GRATIS |
| 8 | DDD vs estado                            | BrasilAPI                    | GRATIS |
| 9 | Firma digital ICP-Brasil/GOV.BR en PDF   | Verificador ITI (web) / verificador UFSC (self-host) | GRATIS |
|10 | GPS onboarding vs lat/lon del CEP        | BrasilAPI CEP v2             | GRATIS |
|11 | CPF: adaptador Serpro en modo trial      | Serpro trial (datos ficticios)| GRATIS (dev) |

## 💰 DE PAGO — Etapa 4 futura

| # | Validación                              | API                          | Costo estimado*     |
|---|------------------------------------------|------------------------------|---------------------|
|12 | CPF: situación cadastral + nombre + nac. | SERPRO Consulta CPF          | ~R$0,02-0,11/cons.  |
|13 | CNH: QR contra base Senatran             | Datavalid QR CNH             | ~R$0,20-0,90/val.   |
|14 | CIN: QR criptográfico                    | Vio-Decoder (Serpro)         | por consumo         |
|15 | Biometría facial vs base gubernamental   | Datavalid facial + liveness  | ~R$0,30-0,90/val.   |
|16 | Certidões CND/CNDT/CRF                   | Infosimples                  | ~R$0,10-0,60/cons.  |
|17 | Dirección vía Open Finance               | Belvo / Pluggy               | ~R$0,50-2,00/cons.  |
|18 | Forense documental comercial (score)     | Veryfi/Resistant/Inscribe... | enterprise          |

(*) Precios estimados sujetos a confirmación en Loja Serpro / proveedor.

## ⚠️ Sin solución total (ni gratis ni pagando)

| Documento              | Máx.    | Estrategia                                   |
|------------------------|---------|----------------------------------------------|
| RG antiguo (sin QR)    | ~70%    | CPF impreso + biometría Datavalid; score reducido; pedir CNH/CIN en montos altos |
| Contrato Social        | ~75%    | Cruce QSA/capital vs RFB (gratis); Junta Comercial manual solo en EDD |
| CCMEI                  | ~90%    | Firma ICP-Brasil (gratis) o código de control web (scraping/Infosimples) |
| Recibos servicios públ.| ~60-70% | Etapas 1-3 gratis + triangulación GPS; Open Finance opcional |

---

# LISTO PARA INICIAR EL DESARROLLO

Orden sugerido (por slice, spec Gherkin → prueba de dominio → implementación,
según CLAUDE.md):

1. **Etapa 1 — Extracción y persistencia.** Puerto `DocumentExtractor` (adapter
   Gemini) + `FileForensics` (adapter ExifTool); tabla `document_extractions`
   (con `tenant_id`, hash SHA-256, JSON de campos, JSON de metadata, timestamps;
   append-only). Toda escritura vía `withTenantTx`.
2. **Etapa 2 — Motor de reglas locales.** Dominio puro, sin I/O: mod-11
   CPF/CNPJ, FEBRABAN, coherencia de fechas, reglas sobre metadata persistida.
   Salida: `ValidationAlert[] {campo, severidad, detalle}` persistidas.
3. **Etapa 3 — Verificadores externos gratuitos.** Puerto
   `ExternalVerification` con adapters: MinhaReceita, BrasilApiCep, BrasilApiDdd.
   Cruces campo a campo (negocio vs RFB, CEP, CNPJ distribuidora, titular vs QSA).
   Timeouts + reintentos con backoff; idempotencia por hash del documento.
4. **Etapa 4 — Stub Serpro trial.** Mismo puerto, adapter `SerproCpfTrial`
   (gratis, datos ficticios) para dejar el enchufe listo sin contratar.

Invariantes a probar desde el día 1:
- Un documento con `situacao_cadastral != ATIVA` nunca llega a score aprobado.
- Valor impreso != valor del código de barras ⇒ alerta CRITICA.
- Re-subir el mismo archivo (mismo hash) no re-ejecuta extracción (idempotencia).
- Toda alerta y extracción queda en audit log append-only con `tenantId`.

REGLA DE ORO: la IA extrae y cruza; la AUTENTICIDAD la da la fuente
emisora o el QR criptográfico. Donde no hay fuente consultable
(recibos, RG viejo), se trabaja con score, no con certeza, y se
compensa con triangulación de datos verificables.

---

# DIRECTORIO CONSOLIDADO DE URLs

GRATUITAS (Etapas 1-3):
- BrasilAPI ................. https://brasilapi.com.br/docs
- Minha Receita ............. https://docs.minhareceita.org/
- Minha Receita (código) .... https://github.com/cuducos/minha-receita
- OpenCNPJ .................. https://opencnpj.org/
- CNPJá Open ................ https://cnpja.com/api/open
- ViaCEP .................... https://viacep.com.br/
- Verificador ITI ........... https://validar.iti.gov.br/
- Redesim (validar compr.) .. https://www.gov.br/empresas-e-negocios/pt-br/redesim
- ExifTool .................. https://exiftool.org/
- Sherloq (forense imagen) .. https://github.com/GuidoBartoli/sherloq
- Serpro trial (dev gratis) . https://apicenter.estaleiro.serpro.gov.br/

DE PAGO (Etapa 4, self-service, costo bajo):
- Loja Serpro (CPF/Datavalid/Vio) ... https://loja.serpro.gov.br/
- Docs Serpro APIs .................. https://apicenter.estaleiro.serpro.gov.br/
- Infosimples ....................... https://infosimples.com/consultas/
- CNPJá comercial ................... https://cnpja.com/api
- Hub do Desenvolvedor .............. https://www.hubdodesenvolvedor.com.br/

OPEN FINANCE (triangulación de dirección):
- Belvo ..................... https://belvo.com/
- Pluggy .................... https://pluggy.ai/

FORENSE DOCUMENTAL COMERCIAL (score probabilístico):
- Veryfi .................... https://www.veryfi.com/
- DocVerify ................. https://docverify.app/
- Resistant AI .............. https://resistant.ai/
- Inscribe .................. https://www.inscribe.ai/
- Koncile ................... https://www.koncile.ai/

REFERENCIA ACADÉMICA:
- AIForge-Doc (límites de VLMs como detectores) ... https://arxiv.org/html/2602.20569v1
