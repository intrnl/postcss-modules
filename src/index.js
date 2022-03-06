const path = require('path');
const crypto = require('crypto');

const parser = require('postcss-selector-parser');


const COMPOSES_RE = /^(?<name>[^\s]+?)(?:$|(?:\s+from\s+(?<specifier>global|(?<quote>['"]).+\k<quote>))$)/;

function defaultGenerateScopedName (local, filename) {
	const hash = crypto.createHash('md5');
	hash.update(filename ? path.relative('.', filename) : '');

	const digest = hash.digest('base64url');

	return `${local}_${digest.slice(0, 6)}`;
}

/** @returns {import('postcss').Plugin} */
module.exports = (opts = {}) => {
	const { generateScopedName = defaultGenerateScopedName } = opts;

	return {
		postcssPlugin: '@intrnl/postcss-modules',
		OnceExit (root, { result }) {
			const locals = Object.create(null);

			root.walkAtRules('keyframes', (rule) => {
				const name = rule.params;
				rule.params = retrieveLocal(name).local;
			});

			root.walkDecls('composes', (decl) => {
				// throw if composes is used on nested rules
				// valid: .foo { ... }
				// invalid: @media (screen) { .foo { ... } }
				if (decl.parent.parent.type !== 'root') {
					throw decl.error(`composes cannot be used within nested rules`)
				}

				// throw if composes is used on a non-simple class selector
				// valid: .foo { ... }
				// valid: .foo, .bar { ... }
				// invalid: button { ... }
				// invalid: .foo:has(.bar) { ... }
				const selectors = parser().astSync(decl.parent.selector);
				const names = retrieveSelectorNames(selectors);

				if (!names) {
					throw decl.error(`composes cannot be used on a non-simple class selector`);
				}

				// local: composes: foo
				// global: composes: foo from global
				// import: composes: foo from './foo.css'
				const match = COMPOSES_RE.exec(decl.value);

				if (!match) {
					throw decl.error(`invalid composes`);
				}

				decl.remove();

				const { name, specifier, quote } = match.groups;

				let res;

				if (specifier === 'global') {
					res = { type: 'global', name };
				}
				else if (quote) {
					res = { type: 'dependency', name, specifier: specifier.slice(1, -1) };
				}
				else {
					res = { type: 'local', name, local: retrieveLocal(name).local };
				}

				for (const name of names) {
					const local = retrieveLocal(name);
					local.composes.push(res);
				}
			});

			root.walkDecls(/^animation/, (decl) => {
				if (decl.prop === 'animation-name') {
					const name = decl.value;
					decl.value = retrieveLocal(name).local;
				}
				else if (decl.prop === 'animation') {
					const list = decl.value.split(/\s+/);

					for (let idx = 0; idx < list.length; idx++) {
						const value = list[idx];

						if (value in locals) {
							list[idx] = locals[value].local;
						}
					}

					decl.value = list.join(' ');
				}
			});

			root.walkRules((rule) => {
				const processor = parser(transformSelectors);

				// this returns a string
				const result = processor.processSync(rule.selector);
				rule.selector = result;
			});

			result.messages.push({
				type: 'export-locals',
				plugin: '@intrnl/postcss-modules',
				locals,
			});

			/**
			 *
			 * @param {parser.Root} selectors
			 */
			function transformSelectors (selectors) {
				const globals = new WeakSet();
				const seen = new WeakSet();

				selectors.walk((node) => {
					if (node.type === 'pseudo') {
						const isLocal = node.value === ':local';
						const isGlobal = node.value === ':global';

						if (!isLocal && !isGlobal) {
							return;
						}

						// :local, not a "call"
						if (node.nodes.length < 1) {
							return;
						}

						// :local(), a "call" but with no arguments
						// :local(foo, bar)
						if (node.nodes.length > 1 || node.nodes[0].nodes.length < 1) {
							throw selectors.error(`expected a single selector as argument to ${node.value}()`);
						}

						const selector = node.nodes[0];

						if (isGlobal) {
							globals.add(selector);
						}

						node.replaceWith(selector);
						return;
					}

					if (node.type === 'class' || node.type === 'id') {
						if (seen.has(node)) {
							return;
						}

						seen.add(node);

						if (globals.has(node.parent)) {
							return;
						}

						const name = node.value;

						node.value = retrieveLocal(name).local;
						return;
					}
				});
			}

			function retrieveLocal (name) {
				return locals[name] ||= {
					local: generateScopedName(name, root.source?.input.file),
					composes: [],
				};
			}

			function retrieveSelectorNames (selectors) {
				const names = [];

				for (const selector of selectors.nodes) {
					if (selector.nodes.length !== 1) {
						return false;
					}

					const node = selector.nodes[0];

					if (node.type !== 'class' && node.type !== 'id') {
						return false;
					}

					names.push(node.value);
				}

				return names;
			}
		},
	};
};

module.exports.postcss = true;
