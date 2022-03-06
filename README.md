# postcss-modules

PostCSS plugin for transforming CSS modules.

```js
import postcss from 'postcss';
import modules from '@intrnl/postcss-modules';

const source = `
.foo {
  animation: rotate 1.4s linear infinite;
}

@keyframes rotate {}
`;

const processor = postcss([
  modules(),
]);

const result = processor.process(source);

result.messages;
// -> [{ type: 'export-locals', locals: { foo: { ... }, rotate: { ... } } }]
```
