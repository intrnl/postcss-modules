const path = require('path');
const crypto = require('crypto');

const parsel = require('./parsel.js');


const COMPOSES_RE = /^(?<name>[^\s]+?)(?:$|(?:\s+from\s+(?<specifier>global|(?<quote>['"]).+\k<quote>))$)/;

function generateLongScopedName (local, filename, index) {
	const hash = crypto.createHash('md5');
	hash.update(filename ? path.relative('.', filename) : '');

	const digest = hash.digest('base64url');

	return `${local}_${digest.slice(0, 6)}`;
}

function generateShortScopedName (local, filename, index) {
	const hash = crypto.createHash('md5');
	hash.update(filename ? path.relative('.', filename) : '');

	const digest = hash.digest('base64url');

	const start = digest.charCodeAt(0);
	const isAlpha = (start >= 97 && start <= 122) || (start >= 65 && start <= 90);

	return `${!isAlpha ? '_' : ''}${digest.slice(0, 6)}${index}`;
}

/** @returns {import('postcss').Plugin} */
module.exports = (opts = {}) => {
	const { generateScopedName = generateLongScopedName } = opts;

	return {
		postcssPlugin: '@intrnl/postcss-modules',
		OnceExit (root, { result }) {
			const locals = Object.create(null);
			let index = 0;

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
				const sel = parsel.parse(decl.parent.selector);
				const names = retrieveSelectorNames(sel);

				if (!names) {
					throw decl.error(`composes cannot be used with complex selectors`);
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
				const globals = new WeakSet();

				const markAsGlobal = (node) => {
					if (node.type === 'class' || node.type === 'id') {
						globals.add(node);
					}
				};

				let sel = parsel.parse(rule.selector);

				const walker = (node, parent) => {
					if (node.type === 'pseudo-class') {
						const isLocal = node.name === 'local';
						const isGlobal = node.name === 'global';

						if (!isLocal && !isGlobal) {
							return;
						}

						const args = parsel.parse(node.argument);

						if (!args || args.type === 'list') {
							throw rule.error(
								`expected a single selector as argument to :${node.name}()`,
								{ index: node.pos[0], endIndex: node.pos[1] },
							);
						}

						if (isGlobal) {
							parsel.walk(args, markAsGlobal);
						}

						parsel.walk(args, walker, node);

						if (!parent) {
							sel = args;
						}
						else if (parent.type === 'complex') {
							if (parent.left === node) {
								parent.left = args;
							}
							else if (parent.right === node) {
								parent.right = args;
							}
						}
						else if (parent.type === 'compound' || parent.type === 'list') {
							const idx = parent.list.indexOf(node);

							if (idx > -1) {
								parent.list[idx] = args;
							}
						}

						return;
					}

					if (node.type === 'class' || node.type === 'id') {
						if (globals.has(node)) {
							return;
						}

						const name = node.name;

						node.name = retrieveLocal(name).local;
						return;
					}
				};

				parsel.walk(sel, walker);
				rule.selector = stringify(sel);
			});

			result.messages.push({
				type: 'export-locals',
				plugin: '@intrnl/postcss-modules',
				locals,
			});

			function retrieveLocal (name) {
				return locals[name] ||= {
					local: generateScopedName(name, root.source?.input.file, index++),
					composes: [],
				};
			}

			function retrieveSelectorNames (node) {
				const names = [];

				if (node.type === 'list') {
					for (const child of node.list) {
						if (node.type === 'class' || node.type === 'id') {
							names.push(child.name);
						}
						else {
							return false;
						}
					}
				}
				else if (node.type === 'class' || node.type === 'id') {
					names.push(node.name);
				}
				else {
					return false;
				}

				return names;
			}
		},
	};
};

module.exports.postcss = true;
module.exports.generateLongScopedName = generateLongScopedName;
module.exports.generateShortScopedName = generateShortScopedName;

function stringify (node) {
	if (typeof node === 'string') {
		return node;
	}

	if (!node) {
		return '';
	}

	switch (node.type) {
		case 'type': {
			return node.name;
		}
		case 'class': {
			return '.' + node.name;
		}
		case 'id': {
			return '.' + node.name;
		}
		case 'attribute': {
			if (node.operator) {
				return '[' + node.name + node.operator + node.value + ']';
			}

			return '[' + node.name + ']';
		}
		case 'pseudo-element': {
			if (node.subtree) {
				return '::' + node.name + stringify(node.subtree);
			}

			if (node.argument) {
				return '::' + node.name + '(' + node.argument + ')';
			}

			return '::' + node.name;
		}
		case 'pseudo-class': {
			if (node.subtree) {
				return ':' + node.name + '(' + stringify(node.subtree) + ')';
			}

			if (node.argument) {
				return ':' + node.name + '(' + node.argument + ')';
			}

			return ':' + node.name;
		}
		case 'complex': {
			return stringify(node.left) + node.combinator + stringify(node.right);
		}
		case 'list': {
			return node.list.map((child) => stringify(child)).join(',');
		}
		case 'compound': {
			return node.list.map((child) => stringify(child)).join('');
		}
	}
}
