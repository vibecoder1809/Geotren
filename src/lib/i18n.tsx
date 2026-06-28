'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

export type Lang = 'ca' | 'es' | 'en'

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'ca', label: 'Català' },
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
]

const STORAGE_KEY = 'geotren-lang'

// Translation dictionary. Keys are language-neutral; Catalan is the source language.
// Values may be plain strings or functions for interpolation/pluralisation.
const DICT = {
  // ── Header ──
  live:            { ca: 'En viu',     es: 'En vivo',     en: 'Live' },
  trains:          { ca: 'trens',      es: 'trenes',      en: 'trains' },
  lines:           { ca: 'línies',     es: 'líneas',      en: 'lines' },
  updatedShort:    { ca: 'Act.',       es: 'Act.',        en: 'Upd.' },
  theme:           { ca: 'Tema',       es: 'Tema',        en: 'Theme' },
  refresh:         { ca: 'Refresca',   es: 'Actualizar',  en: 'Refresh' },
  loading:         { ca: 'Carregant…', es: 'Cargando…',   en: 'Loading…' },
  language:        { ca: 'Idioma',     es: 'Idioma',      en: 'Language' },

  // ── Relative time ──
  justNow:         { ca: 'ara mateix',                     es: 'ahora mismo',                  en: 'just now' },
  secsAgo:         { ca: (s: number) => `fa ${s}s`,        es: (s: number) => `hace ${s}s`,    en: (s: number) => `${s}s ago` },
  minsAgo:         { ca: (m: number) => `fa ${m}m`,        es: (m: number) => `hace ${m}m`,    en: (m: number) => `${m}m ago` },

  // ── Tabs ──
  tabTrains:       { ca: 'Trens',      es: 'Trenes',      en: 'Trains' },
  tabStations:     { ca: 'Estacions',  es: 'Estaciones',  en: 'Stations' },
  tabPlan:         { ca: 'Anar a…',    es: 'Ir a…',       en: 'Go to…' },

  // ── Sidebar: line filter ──
  filterByLine:    { ca: 'Filtre per Línia', es: 'Filtro por Línea', en: 'Filter by Line' },
  all:             { ca: 'Tots',       es: 'Todos',       en: 'All' },
  groupUrban:      { ca: 'L — Barcelona urbà',           es: 'L — Barcelona urbano',           en: 'L — Barcelona urban' },
  groupValles:     { ca: 'S — Vallès',                   es: 'S — Vallès',                     en: 'S — Vallès' },
  groupRegional:   { ca: 'R — Llobregat-Anoia regional', es: 'R — Llobregat-Anoia regional',   en: 'R — Llobregat-Anoia regional' },
  groupOther:      { ca: 'Altres',     es: 'Otras',       en: 'Other' },
  groupUrbanShort: { ca: 'L — Urbà',   es: 'L — Urbano',  en: 'L — Urban' },
  groupVallesShort:{ ca: 'S — Vallès', es: 'S — Vallès',  en: 'S — Vallès' },
  groupRegionalShort:{ ca: 'R — Reg.', es: 'R — Reg.',    en: 'R — Reg.' },
  noActiveTrains:  { ca: 'Cap tren actiu.', es: 'Ningún tren activo.', en: 'No active trains.' },

  // ── Sidebar: stations ──
  searchStation:   { ca: 'Cerca Estació', es: 'Buscar Estación', en: 'Search Station' },
  searchStationPlaceholder: { ca: 'Ex: Sant Cugat, Provença…', es: 'Ej: Sant Cugat, Provença…', en: 'E.g. Sant Cugat, Provença…' },
  searchStationShort: { ca: 'Cerca estació…', es: 'Buscar estación…', en: 'Search station…' },
  passingNowSoon:  { ca: 'Trens passant ara o pròximament', es: 'Trenes pasando ahora o próximamente', en: 'Trains passing now or soon' },
  hereNow:         { ca: 'ARA AQUÍ',   es: 'AQUÍ AHORA',  en: 'HERE NOW' },
  stopsAway:       { ca: (n: number) => `${n} parada${n !== 1 ? 'es' : ''}`, es: (n: number) => `${n} parada${n !== 1 ? 's' : ''}`, en: (n: number) => `${n} stop${n !== 1 ? 's' : ''}` },
  towards:         { ca: 'cap a',      es: 'hacia',       en: 'to' },
  occupancyLabel:  { ca: 'ocupació',   es: 'ocupación',   en: 'occupancy' },
  noTrainHere:     { ca: 'Cap tren detectat passant per aquesta estació.', es: 'Ningún tren detectado pasando por esta estación.', en: 'No trains detected passing through this station.' },
  searchToSeeTrains: { ca: 'Cerca una estació per veure els trens.', es: 'Busca una estación para ver los trenes.', en: 'Search a station to see its trains.' },
  noStationFound:  { ca: 'Cap estació trobada.', es: 'Ninguna estación encontrada.', en: 'No station found.' },
  typeStationName: { ca: "Escriu el nom d'una estació.", es: 'Escribe el nombre de una estación.', en: 'Type a station name.' },

  // ── DetailPanel ──
  activeService:   { ca: 'SERVEI ACTIU FGC', es: 'SERVICIO ACTIVO FGC', en: 'ACTIVE FGC SERVICE' },
  line:            { ca: 'Línia',      es: 'Línea',       en: 'Line' },
  unit:            { ca: 'Unitat',     es: 'Unidad',      en: 'Unit' },
  finalDest:       { ca: 'Destinació final', es: 'Destino final', en: 'Final destination' },
  punctuality:     { ca: 'Puntualitat', es: 'Puntualidad', en: 'Punctuality' },
  onTime:          { ca: 'Puntual',    es: 'Puntual',     en: 'On time' },
  avgOccupancy:    { ca: 'Ocupació mitjana', es: 'Ocupación media', en: 'Avg. occupancy' },
  occupancyPerCar: { ca: 'Ocupació per cotxe', es: 'Ocupación por coche', en: 'Occupancy per car' },
  upcomingStops:   { ca: 'Pròximes parades', es: 'Próximas paradas', en: 'Upcoming stops' },
  origin2:         { ca: 'origen',     es: 'origen',      en: 'origin' },
  terminal:        { ca: 'terminal',   es: 'terminal',    en: 'terminal' },
  inTransit:       { ca: 'En trànsit…', es: 'En tránsito…', en: 'In transit…' },
  hereNowLabel:    { ca: 'Ara aquí',   es: 'Aquí ahora',  en: 'Here now' },

  // ── TrainCard ──
  occupied:        { ca: 'ocupat',     es: 'ocupado',     en: 'occupied' },
  nowAt:           { ca: 'Ara a',      es: 'Ahora en',    en: 'Now at' },
  nextStop:        { ca: 'Pròxima parada', es: 'Próxima parada', en: 'Next stop' },
  etaNow:          { ca: 'ara',        es: 'ahora',       en: 'now' },
  etaIn:           { ca: (m: number) => m === 1 ? 'en 1 min' : `en ${m} min`, es: (m: number) => m === 1 ? 'en 1 min' : `en ${m} min`, en: (m: number) => m === 1 ? 'in 1 min' : `in ${m} min` },
  departsIn:       { ca: 'arriba en',  es: 'llega en',    en: 'arrives in' },
  departed:        { ca: 'sortit',     es: 'salido',      en: 'departed' },

  // ── StopPanel ──
  stationFgc:      { ca: 'ESTACIÓ FGC', es: 'ESTACIÓN FGC', en: 'FGC STATION' },
  accessible:      { ca: 'Accessible', es: 'Accesible',   en: 'Accessible' },
  loadingData:     { ca: 'Carregant dades…', es: 'Cargando datos…', en: 'Loading data…' },
  weatherLabel:    { ca: 'Meteorologia', es: 'Meteorología', en: 'Weather' },
  airQuality:      { ca: "Qualitat de l'aire", es: 'Calidad del aire', en: 'Air quality' },
  airQualityIndex: { ca: "Índex de qualitat de l'aire", es: 'Índice de calidad del aire', en: 'Air quality index' },
  noEnvData:       { ca: 'Sense dades ambientals per a aquesta estació.', es: 'Sin datos ambientales para esta estación.', en: 'No environmental data for this station.' },
  airGood:         { ca: 'Bo',         es: 'Bueno',       en: 'Good' },
  airModerate:     { ca: 'Moderat',    es: 'Moderado',    en: 'Moderate' },
  airBad:          { ca: 'Dolent',     es: 'Malo',        en: 'Poor' },

  // ── TripPlanner ──
  origin:          { ca: 'Origen',     es: 'Origen',      en: 'Origin' },
  destination:     { ca: 'Destinació', es: 'Destino',     en: 'Destination' },
  fromWhere:       { ca: "D'on surts?", es: '¿De dónde sales?', en: 'Where from?' },
  toWhere:         { ca: 'On vas?',    es: '¿A dónde vas?', en: 'Where to?' },
  swap:            { ca: 'Intercanviar', es: 'Intercambiar', en: 'Swap' },
  direct:          { ca: 'Directe',    es: 'Directo',     en: 'Direct' },
  transfers:       { ca: (n: number) => `${n} transbord${n > 1 ? 'aments' : 'ament'}`, es: (n: number) => `${n} transbordo${n > 1 ? 's' : ''}`, en: (n: number) => `${n} transfer${n > 1 ? 's' : ''}` },
  delayLive:       { ca: (line: string, d: number) => `${line} circula amb +${d} min de retard ara mateix`, es: (line: string, d: number) => `${line} circula con +${d} min de retraso ahora mismo`, en: (line: string, d: number) => `${line} is running +${d} min late right now` },
  calcRoute:       { ca: 'Calculant ruta…', es: 'Calculando ruta…', en: 'Calculating route…' },
  sameOriginDest:  { ca: "L'origen i la destinació són iguals", es: 'El origen y el destino son iguales', en: 'Origin and destination are the same' },
  cannotConnect:   { ca: 'No es pot connectar', es: 'No se puede conectar', en: 'Cannot connect' },
  genericError:    { ca: 'Error',      es: 'Error',       en: 'Error' },
  noDirectRoute:   { ca: "No s'ha trobat cap ruta directa per avui amb aquestes estacions.", es: 'No se ha encontrado ninguna ruta directa para hoy con estas estaciones.', en: 'No direct route found for today with these stations.' },
  pickOriginDest:  { ca: "Tria origen i destinació per veure els pròxims trens i l'hora d'arribada.", es: 'Elige origen y destino para ver los próximos trenes y la hora de llegada.', en: 'Pick origin and destination to see upcoming trains and arrival time.' },
  leaveNow:        { ca: 'Sortir ara',  es: 'Salir ahora',  en: 'Leave now' },
  leaveAt:         { ca: 'Sortir a les', es: 'Salir a las', en: 'Leave at' },
  changeTime:      { ca: 'Canviar hora', es: 'Cambiar hora', en: 'Change time' },
  onDay:           { ca: 'el dia',     es: 'el día',      en: 'on' },
  today:           { ca: 'avui',       es: 'hoy',         en: 'today' },
  stepFreeRoute:   { ca: 'Itinerari accessible', es: 'Itinerario accesible', en: 'Step-free route' },
  showStepFree:    { ca: 'Veure itinerari sense escales', es: 'Ver itinerario sin escalones', en: 'Show step-free route' },
  hideStepFree:    { ca: 'Amagar itinerari', es: 'Ocultar itinerario', en: 'Hide route' },

  // ── Alerts ──
  alert:           { ca: 'ALERTA',     es: 'ALERTA',      en: 'ALERT' },

  // ── App-level errors ──
  apiConnectError: { ca: "No es pot connectar amb l'API de trens", es: 'No se puede conectar con la API de trenes', en: 'Cannot connect to the trains API' },
} as const

export type TransKey = keyof typeof DICT

type Entry = (typeof DICT)[TransKey]

interface I18nContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  // Interpolation args are passed positionally to the matching dictionary
  // function. Per-key arg typing is intentionally loose so a `TransKey` union
  // (e.g. a line-group's labelKey) can be passed without widening the tuple.
  t: (key: TransKey, ...args: (string | number)[]) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ca')

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    if (stored === 'ca' || stored === 'es' || stored === 'en') setLangState(stored)
  }, [])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { window.localStorage.setItem(STORAGE_KEY, l) } catch {}
    document.documentElement.setAttribute('lang', l)
  }, [])

  const t = useCallback<I18nContextValue['t']>((key, ...args) => {
    const entry = DICT[key] as Entry
    const value = entry[lang]
    if (typeof value === 'function') {
      return (value as (...a: (string | number)[]) => string)(...args)
    }
    return value
  }, [lang])

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider')
  return ctx
}
