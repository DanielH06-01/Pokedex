// ==========================================
// POKÉDEX IA
// Un Pokémon a la vez en pantalla + un chat que habla de ese Pokémon.
// ==========================================

// ==========================================
// 1. CONSTANTES Y ESTADO
// ==========================================
const API = 'https://pokeapi.co/api/v2';
const MAX_ID = 151; // Solo la primera generación

// [etiqueta en español, color]
const TIPOS = {
  normal:   ['Normal',    '#9a9a72'],
  fire:     ['Fuego',     '#ee7a2c'],
  water:    ['Agua',      '#4f80ec'],
  electric: ['Eléctrico', '#d9a800'],
  grass:    ['Planta',    '#56b344'],
  ice:      ['Hielo',     '#4dbbbb'],
  fighting: ['Lucha',     '#c03028'],
  poison:   ['Veneno',    '#a040a0'],
  ground:   ['Tierra',    '#b98f3e'],
  flying:   ['Volador',   '#8a75e0'],
  psychic:  ['Psíquico',  '#f0507f'],
  bug:      ['Bicho',     '#8fa012'],
  rock:     ['Roca',      '#a08a2c'],
  ghost:    ['Fantasma',  '#6a5294'],
  dragon:   ['Dragón',    '#6a34f0'],
  dark:     ['Siniestro', '#6a5040'],
  steel:    ['Acero',     '#8f8fae'],
  fairy:    ['Hada',      '#e0779c'],
};

const STATS_ES = {
  hp: 'PS',
  attack: 'Ataque',
  defense: 'Defensa',
  'special-attack': 'At. esp.',
  'special-defense': 'Def. esp.',
  speed: 'Velocidad',
};

const FRASES_ESPERA = [
  '📡 Consultando la Pokédex...',
  '🔍 Analizando datos...',
  '⚡ Escaneando al Pokémon...',
  '🎒 Buscando en la mochila del Profesor Oak...',
];

let actual = null;        // { datos, especie, descripcion, categoria }
let esShiny = false;
let listaNombres = [];
let solicitud = 0;        // evita que una búsqueda lenta pise a una más nueva
let enviando = false;
let audioActual = null;
const cache = new Map();

// ==========================================
// 2. REFERENCIAS AL DOM
// ==========================================
const $ = (id) => document.getElementById(id);

const lente = $('lente');
const pantalla = $('pantalla');
const pokeImg = $('pokeImg');
const estadoBusqueda = $('estadoBusqueda');
const datalistNombres = $('datalistNombres');
const inputBuscar = $('inputBuscar');
const btnShiny = $('btnShiny');
const btnGrito = $('btnGrito');
const btnLeer = $('btnLeer');
const chatMensajes = $('chatMensajes');
const chatInput = $('chatInput');
const btnEnviar = $('btnEnviar');


// ==========================================
// 3. UTILIDADES
// ==========================================
function nombreBonito(nombre) {
  return nombre.replace(/-/g, ' ');
}

function setEstado(texto, esError = false) {
  estadoBusqueda.textContent = texto;
  estadoBusqueda.classList.toggle('error', esError);
}

function escaparHTML(texto) {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Convierte el texto de la IA (con **negrita** y listas) en HTML seguro
function formatearTexto(texto) {
  return escaparHTML(texto)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/\n/g, '<br>');
}

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = temp;
    }
  }
  return fila[b.length];
}

// Convierte lo que escribió el usuario en un nombre/ID válido de la PokéAPI.
// Tolera errores: "picachu" -> "pikachu".
function resolverNombre(texto) {
  const t = texto.replace(/^#/, '').trim().replace(/\s+/g, '-');
  if (!t) return null;

  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= MAX_ID ? String(n) : null;
  }

  if (listaNombres.length === 0) return t; // la lista aún no cargó: probamos tal cual
  if (listaNombres.includes(t)) return t;

  const empiezaCon = listaNombres.find((n) => n.startsWith(t));
  if (empiezaCon) return empiezaCon;

  if (t.length >= 3) {
    const contiene = listaNombres.find((n) => n.includes(t));
    if (contiene) return contiene;
  }

  let mejor = null;
  let menor = Infinity;
  for (const n of listaNombres) {
    const d = distancia(t, n);
    if (d < menor) { menor = d; mejor = n; }
  }
  return menor <= 2 ? mejor : null;
}


// ==========================================
// 4. DATOS DE LA POKÉAPI
// ==========================================
async function obtenerPokemon(clave) {
  const k = String(clave).toLowerCase().trim();
  if (cache.has(k)) return cache.get(k);

  const res = await fetch(`${API}/pokemon/${encodeURIComponent(k)}`);
  if (!res.ok) throw new Error('no-encontrado');
  const datos = await res.json();

  let especie = null;
  try {
    const resEspecie = await fetch(datos.species.url);
    if (resEspecie.ok) especie = await resEspecie.json();
  } catch {
    // Seguimos sin descripción
  }

  const info = { datos, especie };
  cache.set(k, info);
  cache.set(String(datos.id), info);
  cache.set(datos.name, info);
  return info;
}

function descripcionEs(especie) {
  if (!especie) return { texto: 'No hay entrada de la Pokédex para este Pokémon.', idioma: 'es' };

  const limpiar = (t) => t.replace(/[\n\f\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  const entradas = especie.flavor_text_entries || [];
  const es = entradas.filter((e) => e.language.name === 'es');
  const en = entradas.filter((e) => e.language.name === 'en');
  const lista = es.length ? es : en;
  const ultima = lista[lista.length - 1];

  if (!ultima) return { texto: 'No hay entrada de la Pokédex para este Pokémon.', idioma: 'es' };
  return { texto: limpiar(ultima.flavor_text), idioma: es.length ? 'es' : 'en' };
}

function categoriaEs(especie) {
  const generos = (especie && especie.genera) || [];
  const g = generos.find((x) => x.language.name === 'es') || generos.find((x) => x.language.name === 'en');
  return g ? g.genus : '';
}

function urlImagen(datos, shiny) {
  const arte = datos.sprites.other && datos.sprites.other['official-artwork'];
  const normal = (arte && arte.front_default) || datos.sprites.front_default || '';
  const brillante = (arte && arte.front_shiny) || datos.sprites.front_shiny || '';
  return shiny ? (brillante || normal) : normal;
}

function tieneShiny(datos) {
  const arte = datos.sprites.other && datos.sprites.other['official-artwork'];
  return Boolean((arte && arte.front_shiny) || datos.sprites.front_shiny);
}


// ==========================================
// 5. PANTALLA DE LA POKÉDEX
// ==========================================
function escanear() {
  pantalla.classList.remove('escaneando');
  void pantalla.offsetWidth; // reinicia la animación
  pantalla.classList.add('escaneando');
}
pantalla.addEventListener('animationend', (e) => {
  if (e.target === pantalla) pantalla.classList.remove('escaneando');
});

function iniciarCarga() {
  pantalla.classList.add('cargando');
  lente.classList.add('arrancando');
  escanear();
}

function terminarCarga() {
  pantalla.classList.remove('cargando');
  lente.classList.remove('arrancando');
}

function pintarImagen() {
  if (!actual) return;
  const url = urlImagen(actual.datos, esShiny);
  pokeImg.hidden = !url;
  if (!url) return;
  pokeImg.alt = nombreBonito(actual.datos.name);
  pokeImg.classList.remove('aparece');
  void pokeImg.offsetWidth;
  pokeImg.src = url;
  pokeImg.classList.add('aparece');
}

// Si la imagen grande falla, usamos el sprite pequeño
pokeImg.addEventListener('error', () => {
  const respaldo = actual && actual.datos.sprites.front_default;
  if (respaldo && pokeImg.getAttribute('src') !== respaldo) pokeImg.src = respaldo;
});

function mostrarPokemon(info) {
  const { datos, especie } = info;
  const cambio = !actual || actual.datos.id !== datos.id;
  const desc = descripcionEs(especie);

  actual = { ...info, descripcion: desc, categoria: categoriaEs(especie) };
  esShiny = false;
  detenerVoz();

  // Color del tipo principal: tiñe pantalla, ficha y fondo
  const tipoPrincipal = datos.types[0].type.name;
  const color = (TIPOS[tipoPrincipal] || ['', '#9a9a72'])[1];
  document.documentElement.style.setProperty('--tipo', color);

  // Pantalla
  terminarCarga();
  $('pantallaMensaje').hidden = true;
  $('pantallaId').textContent = `N.º ${String(datos.id).padStart(4, '0')}`;
  $('pantallaCategoria').textContent = actual.categoria;
  $('pokeNombre').textContent = nombreBonito(datos.name);
  $('pokeTipos').innerHTML = datos.types
    .map((t) => {
      const [etiqueta, c] = TIPOS[t.type.name] || [t.type.name, '#9a9a72'];
      return `<span class="tipo" style="--c:${c}">${etiqueta}</span>`;
    })
    .join('');
  pintarImagen();

  // Controles
  btnShiny.textContent = '✨ Shiny';
  btnShiny.setAttribute('aria-pressed', 'false');
  btnShiny.disabled = !tieneShiny(datos);
  btnGrito.disabled = !(datos.cries && datos.cries.latest);
  btnLeer.disabled = !desc.texto;

  // Ficha
  $('fichaDescripcion').textContent = desc.texto;
  $('datoAltura').textContent = `${(datos.height / 10).toFixed(1)} m`;
  $('datoPeso').textContent = `${(datos.weight / 10).toFixed(1)} kg`;
  $('datoExp').textContent = datos.base_experience ?? '–';

  const contenedorStats = $('fichaStats');
  contenedorStats.innerHTML = datos.stats
    .map((s) => {
      const ancho = Math.min(100, Math.round((s.base_stat / 180) * 100));
      return `
        <div class="stat">
          <span>${STATS_ES[s.stat.name] || s.stat.name}</span>
          <span class="stat-valor">${s.base_stat}</span>
          <div class="stat-barra"><div class="stat-relleno" data-ancho="${ancho}"></div></div>
        </div>`;
    })
    .join('');
  void contenedorStats.offsetWidth; // para que la barra se anime desde 0
  contenedorStats.querySelectorAll('.stat-relleno').forEach((el) => {
    el.style.width = `${el.dataset.ancho}%`;
  });

  // Chat: cabecera y aviso de cambio de Pokémon
  const sprite = datos.sprites.front_default || '';
  $('chatSprite').hidden = !sprite;
  $('chatSprite').src = sprite;
  $('chatTema').textContent = `Hablando de ${nombreBonito(datos.name)}`;
  if (cambio) agregarMensaje('sistema', `En pantalla: ${nombreBonito(datos.name)}`);
}

// Carga un Pokémon en pantalla. Devuelve true si salió bien.
async function cargarPokemon(clave) {
  const miSolicitud = ++solicitud;
  iniciarCarga();

  try {
    const info = await obtenerPokemon(clave);
    if (miSolicitud !== solicitud) return false;
    mostrarPokemon(info);
    return true;
  } catch (error) {
    if (miSolicitud !== solicitud) return false;
    terminarCarga();
    console.error('No se pudo cargar el Pokémon:', error);
    if (!actual) {
      $('pantallaMensaje').hidden = false;
      $('pantallaMensaje').textContent = 'No se pudo conectar con la PokéAPI. Revisa tu conexión.';
    }
    setEstado('No encontré ese Pokémon o falló la conexión. Inténtalo de nuevo.', true);
    return false;
  }
}


// ==========================================
// 6. BÚSQUEDA Y CONTROLES
// ==========================================
async function cargarListaNombres() {
  try {
    const res = await fetch(`${API}/pokemon?limit=${MAX_ID}`);
    if (!res.ok) return;
    const datos = await res.json();
    listaNombres = datos.results.map((p) => p.name);
    datalistNombres.innerHTML = listaNombres.map((n) => `<option value="${n}"></option>`).join('');
  } catch (error) {
    console.warn('No se pudo cargar la lista de nombres:', error);
  }
}

$('formBuscar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = inputBuscar.value.trim().toLowerCase();
  if (!texto) return;

  const clave = resolverNombre(texto);
  if (!clave) {
    setEstado(`No encontré "${texto}". Solo hay 151 Pokémon: prueba con el nombre en inglés o un número del 1 al ${MAX_ID}.`, true);
    return;
  }

  setEstado('');
  const ok = await cargarPokemon(clave);
  if (ok && clave !== texto && !/^\d+$/.test(texto)) {
    setEstado(`Mostrando ${nombreBonito(clave)}, lo más parecido a "${texto}".`);
  }
  if (ok) inputBuscar.value = '';
});

function irA(id) {
  setEstado('');
  cargarPokemon(id);
}

$('btnAnterior').addEventListener('click', () => {
  const id = actual ? actual.datos.id : 25;
  irA(id <= 1 || id > MAX_ID ? MAX_ID : id - 1);
});

$('btnSiguiente').addEventListener('click', () => {
  const id = actual ? actual.datos.id : 25;
  irA(id >= MAX_ID ? 1 : id + 1);
});

$('btnAleatorio').addEventListener('click', () => {
  irA(Math.floor(Math.random() * MAX_ID) + 1);
});

btnShiny.addEventListener('click', () => {
  if (!actual) return;
  esShiny = !esShiny;
  btnShiny.textContent = esShiny ? '✨ Normal' : '✨ Shiny';
  btnShiny.setAttribute('aria-pressed', String(esShiny));
  pintarImagen();
});

btnGrito.addEventListener('click', () => {
  if (!actual || !actual.datos.cries || !actual.datos.cries.latest) return;
  if (audioActual) audioActual.pause();
  audioActual = new Audio(actual.datos.cries.latest);
  audioActual.volume = 0.6;
  audioActual.play().catch(() => setEstado('El navegador bloqueó el audio. Inténtalo otra vez.', true));
});

function detenerVoz() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

btnLeer.addEventListener('click', () => {
  if (!actual) return;
  if (!('speechSynthesis' in window)) {
    setEstado('Tu navegador no puede leer en voz alta.', true);
    return;
  }
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    return;
  }

  const partes = [nombreBonito(actual.datos.name), actual.categoria, actual.descripcion.texto].filter(Boolean);
  const voz = new SpeechSynthesisUtterance(partes.join('. '));
  voz.lang = actual.descripcion.idioma === 'es' ? 'es-ES' : 'en-US';
  voz.rate = 1;
  voz.pitch = 0.9;
  window.speechSynthesis.speak(voz);
});


// ==========================================
// 7. CHAT SOBRE EL POKÉMON EN PANTALLA
// ==========================================
function agregarMensaje(tipo, texto, { html = false, espera = false } = {}) {
  const div = document.createElement('div');
  div.className = `msg ${tipo}${espera ? ' espera' : ''}`;
  if (html) div.innerHTML = texto;
  else div.textContent = texto;
  chatMensajes.appendChild(div);
  chatMensajes.scrollTop = chatMensajes.scrollHeight;
  return div;
}

function bloquearChat(bloquear) {
  enviando = bloquear;
  chatInput.disabled = bloquear;
  btnEnviar.disabled = bloquear;
  if (!bloquear) chatInput.focus();
}

async function enviarMensaje(texto) {
  if (enviando) return;

  agregarMensaje('user', texto);
  const frase = FRASES_ESPERA[Math.floor(Math.random() * FRASES_ESPERA.length)];
  const burbuja = agregarMensaje('ia', frase, { espera: true });
  bloquearChat(true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensaje: texto,
        pokemonActual: actual ? actual.datos.name : null,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      burbuja.classList.remove('espera');
      burbuja.classList.add('error');
      burbuja.textContent = `Error del servidor (${res.status}): ${data.detalle || data.error || 'respuesta no válida'}`;
      return;
    }

    burbuja.classList.remove('espera');
    burbuja.innerHTML = formatearTexto(data.respuesta || 'No recibí respuesta.');

    // Si la IA buscó otro Pokémon, lo mostramos en la pantalla
    const otro = data.pokemonData;
    if (otro && !otro.error && otro.name && (!actual || otro.name !== actual.datos.name)) {
      await cargarPokemon(otro.name);
    }
  } catch (error) {
    console.error('Error conectando al servidor:', error);
    burbuja.classList.remove('espera');
    burbuja.classList.add('error');
    burbuja.textContent = 'No pude conectar con el servidor. ¿Está corriendo Node?';
  } finally {
    bloquearChat(false);
    chatMensajes.scrollTop = chatMensajes.scrollHeight;
  }
}

$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const texto = chatInput.value.trim();
  if (!texto) return;
  chatInput.value = '';
  enviarMensaje(texto);
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => enviarMensaje(chip.dataset.pregunta));
});


// ==========================================
// 8. ARRANQUE
// ==========================================
agregarMensaje(
  'ia',
  'Soy tu Pokédex de la primera generación. Pregúntame sobre el Pokémon en pantalla o pídeme que busque otro.'
);
cargarListaNombres();
cargarPokemon(25); // Pikachu