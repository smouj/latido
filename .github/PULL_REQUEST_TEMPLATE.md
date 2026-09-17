## Qué cambia

<!-- Una o dos frases. Si arregla un issue, enlázalo: «Cierra #123». -->

## Cómo comprobarlo

<!-- Los pasos concretos que has seguido para verificar el cambio. -->

## Lista de comprobación

- [ ] `pnpm test` en verde (tests de `@latido/engine`).
- [ ] `pnpm typecheck` en verde en todo el monorepo.
- [ ] `pnpm verify` ejecutado.
- [ ] Sin secretos ni datos personales en el diff (tokens, claves, bases de datos `*.sqlite`, capturas con datos de terceros).
- [ ] Documentación actualizada si cambia el modelo de datos, los conectores, el cálculo de tendencias o los comandos.
- [ ] Si toca la interfaz: ningún color, tamaño o duración literal; todo sale de `@latido/tokens`.
- [ ] Si toca textos: añadido en `apps/app/src/i18n/index.ts` en los dos idiomas.
