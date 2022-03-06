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

## Why?

Differences between the original [`postcss-modules`][postcss-modules] plugin:

- Does not do linking/resolving whatsoever when composing classes.
  - This proves to be problematic when integrating the original plugin with build tools, the
    resolver doesn't apply to nested dependencies and thus fails if you try to do a nested compose,
    and the linker would lead to duplicated CSS code.
- CSS modules is supported on a best-effort basis.
  - We only support what CSS modules is often used for: deconflicted names, and composing classes.
    Other syntax like [`@value` variables][module-values] are not supported.
  - We don't wrap over existing CSS modules transformation plugins, and with that we removed the
    overhead that is [ICSS][icss] and having to run a separate CSS processor.

[postcss-modules]: https://github.com/madyankin/postcss-modules
[module-values]: https://github.com/css-modules/css-modules/blob/master/docs/values-variables.md
[icss]: https://github.com/css-modules/icss
