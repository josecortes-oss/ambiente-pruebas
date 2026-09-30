---
name: vista-previa-chat
description: Explica la vista previa en vivo del comando de chat "sugerir tablero de <modulo> con <conceptos>". Úsala cuando se pida agregar, tocar o depurar la ruta /tableros/vista-previa, la vista views/vista-previa.ejs, la función ejecutarTableroGenerico() en src/routes/tableros.js, o el campo vistaPrevia en la respuesta del chat.
---

# Vista previa en vivo desde el chat

## Qué cambió

Antes, "sugerir tablero de `<modulo>` con `<conceptos>`" solo mostraba el
YAML propuesto como texto en el chat (`yaml.dump(resultado.def)`) — el
usuario tenía que imaginarse cómo se vería el tablero antes de decidir
crearlo con `crear tablero ...`. Ahora esa misma sugerencia se ejecuta
contra Odoo de verdad y se renderiza en el panel central, igual que un
tablero guardado, pero **sin escribir ningún YAML ni quedar versionada**.

## Cómo funciona

1. **`src/chat.js`** (acción de `sugerir tablero de ...`): en vez de
   devolver el YAML en el texto de respuesta, guarda `modulo` y
   `conceptos` en el objeto `vistaPrevia` que ahora reciben todas las
   acciones de `COMANDOS` (mismo mecanismo que `tableroModificado`, ver
   `responderChat`). La respuesta de texto pasa a ser solo un aviso
   ("Vista previa mostrada en el panel central...").
2. **`src/routes/chat.js`**: reenvía `vistaPrevia` tal cual en el JSON de
   `POST /chat`, junto a `respuesta` y `tableroModificado`.
3. **`views/chat-panel.ejs`**: si la respuesta trae `data.vistaPrevia`,
   arma el query string (`modulo`, `conceptos` separados por coma) y
   navega a `/tableros/vista-previa?...` — mismo patrón de "esperar ~900ms
   y redirigir" que ya usaba `tableroModificado` para tableros guardados.
4. **`GET /tableros/vista-previa`** (`src/routes/tableros.js`): toma
   `modulo`/`conceptos` de la query, llama a
   `semantica.construirDefinicionDesdeConceptos('vista-previa', modulo,
   nombresConceptos)` (la misma función que usa "crear tablero"), ejecuta
   el resultado con `ejecutarTableroGenerico(def)` y renderiza
   `views/vista-previa.ejs`. **Debe declararse antes de `/tableros/:id`**
   en el router — si no, Express interpretaría "vista-previa" como un id
   de tablero.
5. **`ejecutarTableroGenerico(def)`**: la consulta a Odoo (`search_read`),
   la agregación del gráfico (agrupar + sumar, top 8) y el formateo de
   filas que antes vivían inline en `/tableros/:id` se extrajeron a esta
   función, para que la vista previa reuse exactamente la misma lógica que
   un tablero real — no hay una segunda implementación de "cómo se ve un
   gráfico" para el caso "sin guardar".

## Archivos tocados

- `src/chat.js` — `vistaPrevia` como tercer canal de resultado (junto a
  `respuesta` y `tableroModificado`) en `responderChat`.
- `src/routes/chat.js` — reenvía `vistaPrevia` en el JSON de `/chat`.
- `views/chat-panel.ejs` — redirige a `/tableros/vista-previa?...` cuando
  llega `data.vistaPrevia`.
- `src/routes/tableros.js` — `ejecutarTableroGenerico()` (extraída de la
  ruta `/tableros/:id`) y la nueva ruta `GET /tableros/vista-previa`.
- `views/vista-previa.ejs` (nuevo) — renderiza `def`, `columnas`, `filas`,
  `grafico`, `totalRegistros`, con un aviso de que es una vista previa
  (datos en vivo, nada guardado) y el comando exacto para crearlo de
  verdad.

## Si hay que extender esto

- La vista previa **no respeta `tipoGrafico`** (siempre usa el default de
  `views/grafico-cuerpo.ejs`, ver skill [[tableros-tipos-grafico]]): no
  hay filtros interactivos en esta pantalla, solo un preview de una sola
  pasada. Si se quiere elegir tipo de gráfico ahí también, agregar el
  mismo `<select>` que usan Ventas/Compras y pasar `tipoGrafico` como
  query param adicional en el redirect de `chat-panel.ejs`.
- Si se agrega un comando de chat nuevo que también deba mostrar algo en
  el panel central sin guardar, reusar el canal `vistaPrevia` (o sumar uno
  nuevo con el mismo patrón) en vez de inventar otro mecanismo de
  redirect — `responderChat` ya soporta pasar contexto extra por acción.
- No hay test de integración de la ruta `/tableros/vista-previa` en
  `test/app.test.js` todavía (solo se testea `construirDefinicionDesdeConceptos`
  en `test/semantica.test.js` y la acción de chat en `test/chat.test.js`);
  si se toca el render HTML de `vista-previa.ejs`, conviene agregarlo ahí
  siguiendo el patrón de los tests de tablero genérico existentes.
