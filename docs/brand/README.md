# Marca de Latido

Todo lo que hay en esta carpeta se **genera**, no se dibuja a mano:

```bash
node scripts/make-icons.mjs
```

Ese script es la única fuente de verdad de la marca. De ahí salen:

| Archivo | Qué es |
| --- | --- |
| `logo.svg` | Vector maestro, 1024×1024, con transparencia |
| `logo.png` | Mapa de bits maestro, mismo dibujo |
| `../apps/desktop/src-tauri/icons/` | Juego completo: PNG de 16 a 1024, `icon.ico` e `icon.icns` |
| `../apps/app/src/components/logo-path.ts` | La misma geometría como constantes, para que la interfaz dibuje el logo |

Consecuencia práctica: el logo de la cabecera de la aplicación, el icono del
escritorio y el del instalador **no pueden desincronizarse**, porque no son tres
dibujos parecidos, son el mismo.

## La forma

- **La losa**: superelipse (`|x|^4.6 + |y|^4.6 = 1`), no un cuadrado redondeado.
  Es la esquina continua de los iconos modernos, sin el codo que aparece al
  redondear un rectángulo.
- **El latido**: línea base, muesca Q, pico R, valle S y vuelta a la base. Un
  pico por encima y un valle por debajo: eso es lo que el ojo lee como pulso, y no
  una onda cualquiera.
- **El trazo se engrosa en los tamaños pequeños** (×1.35 a 16 px, ×1.24 a 32 px).
  Un trazo proporcional desaparece a ese tamaño; un simple reescalado del icono
  grande lo deja ilegible.
- **Transparencia real** fuera de la losa: sin halo blanco sobre fondos oscuros.

## Colores

| Uso | Valor |
| --- | --- |
| Losa, arriba | `#E4572E` (ascua) |
| Losa, abajo | `#BE3C1B` (ascua quemada) |
| Marca | `#FFF5ED` (blanco cálido, nunca blanco puro) |

El icono se lee tanto en fondo claro como oscuro, así que **no hay versión
alternativa** para modo oscuro: la losa ya aporta el contraste.

## Cómo usarla bien

- **Espacio libre**: deja alrededor al menos el 12 % del ancho de la marca. El
  vector ya trae su propio margen interno; no lo recortes.
- **Tamaño mínimo**: 16 px para el icono completo (está probado a ese tamaño). Si
  necesitas algo más pequeño, usa solo el latido sin la losa.
- **No la deformes**, no la gires, no le cambies el ángulo del degradado ni le
  añadas sombras o biseles. Si hace falta otro color, cambia el token del sistema
  de diseño (`packages/tokens`), no el icono.
- **No la pongas sobre una foto** sin una capa que garantice el contraste.
