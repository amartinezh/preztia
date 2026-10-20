import { createHash } from 'node:crypto';
import { KNOWN_ISPB } from '@preztiaos/domain';
import { SeededRandom } from './random';

// Catálogos de datos ficticios realistas (Brasil y Colombia). Los identificadores generados son
// VÁLIDOS para las reglas del dominio (CPF/CNPJ con dígito verificador, EndToEndId PIX con ISPB
// real), de modo que el antifraude los trate como datos legítimos salvo donde el seed lo quiera.

export const BR_FIRST_NAMES = [
  'Ana',
  'Bruno',
  'Carla',
  'Diego',
  'Eduarda',
  'Fábio',
  'Gabriela',
  'Henrique',
  'Isabela',
  'João',
  'Juliana',
  'Leandro',
  'Mariana',
  'Marcos',
  'Natália',
  'Otávio',
  'Patrícia',
  'Rafael',
  'Renata',
  'Sérgio',
  'Tatiane',
  'Vinícius',
  'Wellington',
  'Adriana',
  'Cláudio',
  'Daniela',
  'Everton',
  'Fernanda',
  'Gustavo',
  'Helena',
  'Igor',
  'Jéssica',
  'Luciano',
  'Márcia',
  'Nelson',
  'Priscila',
  'Roberto',
  'Simone',
  'Thiago',
  'Vanessa',
  'Aline',
  'Caio',
  'Débora',
  'Elaine',
] as const;

export const BR_LAST_NAMES = [
  'Silva',
  'Santos',
  'Oliveira',
  'Souza',
  'Rodrigues',
  'Ferreira',
  'Alves',
  'Pereira',
  'Lima',
  'Gomes',
  'Costa',
  'Ribeiro',
  'Martins',
  'Carvalho',
  'Almeida',
  'Lopes',
  'Soares',
  'Fernandes',
  'Vieira',
  'Barbosa',
  'Rocha',
  'Dias',
  'Nascimento',
  'Andrade',
  'Moreira',
  'Nunes',
  'Marques',
  'Machado',
  'Mendes',
  'Freitas',
  'Cardoso',
  'Ramos',
  'Teixeira',
  'Araújo',
  'Pinto',
  'Campos',
] as const;

export const CO_FIRST_NAMES = [
  'Andrés',
  'Beatriz',
  'Camilo',
  'Diana',
  'Esteban',
  'Flor',
  'Gloria',
  'Hernán',
  'Inés',
  'Jorge',
  'Luisa',
  'Manuel',
  'Natalia',
  'Óscar',
  'Paola',
  'Ricardo',
  'Sandra',
  'Tomás',
] as const;

export const CO_LAST_NAMES = [
  'Restrepo',
  'Gómez',
  'Zapata',
  'Arango',
  'Ospina',
  'Mejía',
  'Correa',
  'Vélez',
  'Cardona',
  'Henao',
  'Londoño',
  'Giraldo',
  'Muñoz',
  'Jaramillo',
  'Montoya',
  'Echeverri',
] as const;

export const BR_BUSINESSES = [
  'Lanchonete',
  'Salão de Beleza',
  'Mercearia',
  'Oficina de Motos',
  'Barbearia',
  'Açougue',
  'Padaria',
  'Loja de Roupas',
  'Ateliê de Costura',
  'Motorista de aplicativo',
  'Bar e Petiscaria',
  'Hortifruti',
  'Papelaria',
  'Pet Shop',
  'Esmalteria',
  'Food Truck',
  'Borracharia',
  'Sorveteria',
  'Loja de Celulares',
  'Distribuidora de Bebidas',
  'Feirante',
  'Doceria',
] as const;

export const CO_BUSINESSES = [
  'Tienda de barrio',
  'Peluquería',
  'Panadería',
  'Taller de motos',
  'Miscelánea',
  'Carnicería',
  'Venta de arepas',
  'Cacharrería',
  'Frutería',
  'Droguería',
  'Papelería',
  'Mototaxista',
] as const;

/** Ciudad de una zona hoja: centro geográfico, DDD/indicativo y calles para las direcciones. */
export interface CityProfile {
  readonly name: string;
  readonly areaCode: string;
  readonly countryCode: '55' | '57';
  readonly lat: number;
  readonly lng: number;
  readonly streets: readonly string[];
  readonly neighborhoods: readonly string[];
  readonly cep: string;
  readonly uf: string;
}

export const CITIES: Readonly<Record<string, CityProfile>> = {
  divinopolis: {
    name: 'Divinópolis',
    areaCode: '37',
    countryCode: '55',
    lat: -20.1389,
    lng: -44.8839,
    streets: [
      'Rua Goiás',
      'Av. Primeiro de Junho',
      'Rua Rio de Janeiro',
      'Av. JK',
      'Rua Pernambuco',
    ],
    neighborhoods: [
      'Centro',
      'Bom Pastor',
      'Niterói',
      'Porto Velho',
      'São José',
    ],
    cep: '35500-000',
    uf: 'MG',
  },
  belo_horizonte: {
    name: 'Belo Horizonte',
    areaCode: '31',
    countryCode: '55',
    lat: -19.9167,
    lng: -43.9345,
    streets: [
      'Rua da Bahia',
      'Av. Afonso Pena',
      'Rua Curitiba',
      'Av. Amazonas',
      'Rua Padre Eustáquio',
    ],
    neighborhoods: [
      'Centro',
      'Savassi',
      'Padre Eustáquio',
      'Barreiro',
      'Venda Nova',
    ],
    cep: '30160-011',
    uf: 'MG',
  },
  sao_paulo_capital: {
    name: 'São Paulo',
    areaCode: '11',
    countryCode: '55',
    lat: -23.5505,
    lng: -46.6333,
    streets: [
      'Rua Augusta',
      'Av. Paulista',
      'Rua 25 de Março',
      'Av. São João',
      'Rua Teodoro Sampaio',
    ],
    neighborhoods: ['Bela Vista', 'Brás', 'Pinheiros', 'Mooca', 'Santana'],
    cep: '01310-100',
    uf: 'SP',
  },
  campinas: {
    name: 'Campinas',
    areaCode: '19',
    countryCode: '55',
    lat: -22.9099,
    lng: -47.0626,
    streets: [
      'Rua Barão de Jaguara',
      'Av. Francisco Glicério',
      'Rua 13 de Maio',
      'Av. Andrade Neves',
    ],
    neighborhoods: [
      'Centro',
      'Cambuí',
      'Taquaral',
      'Ouro Verde',
      'Barão Geraldo',
    ],
    cep: '13010-111',
    uf: 'SP',
  },
  contagem: {
    name: 'Contagem',
    areaCode: '31',
    countryCode: '55',
    lat: -19.9317,
    lng: -44.0536,
    streets: ['Av. João César de Oliveira', 'Rua Rio Comprido'],
    neighborhoods: ['Eldorado', 'Industrial'],
    cep: '32040-000',
    uf: 'MG',
  },
  medellin: {
    name: 'Medellín',
    areaCode: '604',
    countryCode: '57',
    lat: 6.2442,
    lng: -75.5812,
    streets: [
      'Calle 50',
      'Carrera 70',
      'Calle 10',
      'Carrera 43A',
      'Calle San Juan',
    ],
    neighborhoods: ['Laureles', 'El Poblado', 'Belén', 'Robledo', 'Manrique'],
    cep: '050001',
    uf: 'ANT',
  },
  envigado: {
    name: 'Envigado',
    areaCode: '604',
    countryCode: '57',
    lat: 6.1759,
    lng: -75.5917,
    streets: ['Carrera 43', 'Calle 37 Sur', 'Avenida Las Vegas'],
    neighborhoods: ['Zona Centro', 'La Magnolia', 'El Dorado'],
    cep: '055420',
    uf: 'ANT',
  },
};

/** Bancos emisores de PIX con su ISPB oficial (registro semilla del dominio). */
export const PIX_PAYER_BANKS: ReadonlyArray<{ name: string; ispb: string }> = [
  ...KNOWN_ISPB.entries(),
].map(([ispb, name]) => ({ ispb, name }));

const CPF_BASE_DIGITS = 9;

/** CPF válido (dígitos verificadores módulo 11), sin formato. */
export function generateCpf(random: SeededRandom): string {
  let base = random.digits(CPF_BASE_DIGITS);
  while (/^(\d)\1+$/.test(base)) base = random.digits(CPF_BASE_DIGITS);
  const first = cpfDigit(base, 10);
  const second = cpfDigit(base + String(first), 11);
  return `${base}${first}${second}`;
}

function cpfDigit(digits: string, firstWeight: number): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++)
    sum += Number(digits[i]) * (firstWeight - i);
  return ((sum * 10) % 11) % 10;
}

const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** CNPJ válido (matriz 0001 + dígitos verificadores), sin formato. */
export function generateCnpj(random: SeededRandom): string {
  const base = `${random.digits(8)}0001`;
  const first = cnpjDigit(base, CNPJ_FIRST_WEIGHTS);
  const second = cnpjDigit(base + String(first), CNPJ_SECOND_WEIGHTS);
  return `${base}${first}${second}`;
}

function cnpjDigit(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++)
    sum += Number(digits[i]) * weights[i]!;
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** CPF con formato visual 000.000.000-00 (como lo imprime un documento). */
export function formatCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

/** Cédula colombiana ficticia de 10 dígitos. */
export function generateCedula(random: SeededRandom): string {
  return `10${random.digits(8)}`;
}

/**
 * Teléfono de prueba NO asignable (E.164 sin '+'). En Brasil usa el bloque móvil `9 0000-xxxx`,
 * que no se asigna a abonados; en Colombia el bloque `399`, sin operador. Así ningún recordatorio
 * ni aviso del sistema puede llegarle a una persona real aunque el canal esté en producción.
 */
export function testPhone(city: CityProfile, sequence: number): string {
  const suffix = String(sequence).padStart(4, '0');
  return city.countryCode === '55'
    ? `55${city.areaCode}90000${suffix}`
    : `57399000${suffix}`;
}

/** Punto aleatorio alrededor del centro de la ciudad (≈ 4 km de radio). */
export function jitterLocation(
  random: SeededRandom,
  city: CityProfile,
): { lat: number; lng: number } {
  const radiusDeg = 0.04;
  return {
    lat: round6(city.lat + (random.next() - 0.5) * radiusDeg),
    lng: round6(city.lng + (random.next() - 0.5) * radiusDeg),
  };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function address(random: SeededRandom, city: CityProfile): string {
  return `${random.pick(city.streets)}, ${random.int(10, 2400)} — ${random.pick(city.neighborhoods)}, ${city.name}`;
}

/** EndToEndId PIX estructuralmente válido: E + ISPB + yyyyMMddHHmm (UTC) + 11 alfanuméricos. */
export function endToEndId(
  random: SeededRandom,
  ispb: string,
  at: Date,
): string {
  const ts = at.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `E${ispb}${ts}${random.alphanumeric(11)}`;
}

/** Huella sha256 de un contenido (o de una semilla textual para binarios simulados). */
export function sha256Of(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex');
}
