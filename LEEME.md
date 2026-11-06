# Servidor coop online (Colyseus)

Sala de hasta 8 jugadores. Cada uno envía su posición y el servidor la reparte a los demás.

## Probar en local
1. Instala Node.js 18 o superior.
2. En esta carpeta: `npm install` y luego `npm start`.
3. El servidor queda en `ws://localhost:2567`.
4. Abre tu juego en varias pestañas con `cliente-ejemplo.js` para ver a varios jugadores.

## Desplegar en Render
1. Sube esta carpeta a un repositorio de GitHub.
2. En Render: New > Web Service > elige el repositorio.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`. Plan: Free.
4. Cuando termine, copia la URL (https://TU-SERVIDOR.onrender.com).
5. En el cliente cambia `SERVER_URL` a `wss://TU-SERVIDOR.onrender.com` (con wss, no ws).

## Notas
- El plan gratis se duerme tras 15 minutos sin uso. Abre la URL en el navegador para despertarlo antes de jugar.
- Ajusta `MAP_WIDTH` y `MAP_HEIGHT` en `index.js` al tamaño de tu mapa.
