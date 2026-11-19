import type { TofuObject, TofuValue } from "./layer.ts";

// The forms of a value, and the text of each value in the files.
// In the JSON syntax of OpenTofu, each text is a template. Thus the generator escapes each text of a record.

/** The form of the type of a resource and of the type of a backend. */
export const TYPE_FORM: RegExp = /^[a-z][a-z0-9_]*$/;

/** The form of the local name of a provider, for example `example` or `example-beta`. */
export const PROVIDER_FORM: RegExp = /^[a-z][a-z0-9_-]*$/;

/** The form of a name in the files: the name of a resource, of a variable, of an alias and of an argument. */
export const NAME_FORM: RegExp = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * The form of a path of attributes, for example `network[0].address` or `metadata["ssh-keys"]`. A key of a map in quotes has
 * letters, digits and the characters `_ . : / -` only. Thus a path holds no template sequence and no quote of its own.
 */
export const PATH_FORM: RegExp = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*|\[[0-9]+\]|\["[A-Za-z0-9_.:/-]+"\])*$/;

/** The form of the address of a provider in a registry: two or three words with `/` between them. */
export const SOURCE_FORM: RegExp = /^[a-z0-9][a-z0-9.-]*(\/[a-z0-9][a-z0-9_-]*){1,2}$/;

/** The form of a list of versions, for example `>= 1.8, < 2.0`. */
export const VERSION_FORM: RegExp = /^[0-9A-Za-z .,<>=~!+-]+$/;

/** The parts of a reference: the address of a resource, and a path of attributes of it. */
export interface RefParts {
  readonly address: string;
  readonly attribute: string;
}

/**
 * This function gives the parts of the text of a reference, for example `example_server.web.address`.
 * It gives `undefined` for a text with a different form.
 */
export function refParts(ref: string): RefParts | undefined {
  const [type, name, ...rest] = ref.split(".");
  if (type === undefined || name === undefined || rest.length === 0) return undefined;
  // An index stays with the word before it, so the name of the resource can not have one.
  const attribute = rest.join(".");
  if (!TYPE_FORM.test(type) || !NAME_FORM.test(name) || !PATH_FORM.test(attribute)) return undefined;
  return { address: `${type}.${name}`, attribute };
}

/** This function tells if a value is a list. */
export function isList(value: TofuValue): value is readonly TofuValue[] {
  return Array.isArray(value);
}

/** This function tells if a value is an object of values. A list and `null` are not objects. */
export function isObject(value: TofuValue): value is TofuObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** This function tells if an object has a key that starts with `$`: the object is a form, not a map of arguments. */
export function isForm(value: TofuObject): boolean {
  return Object.keys(value).some((key) => key.startsWith("$"));
}

/** This function gives the one value of a form with the one key `key`, when that value is a text. */
function formText(value: TofuObject, key: string): string | undefined {
  const keys = Object.keys(value);
  const text = value[key];
  return keys.length === 1 && keys[0] === key && typeof text === "string" ? text : undefined;
}

/** This function gives the text of a correct reference form, `{ "$ref": "type.name.attribute" }`. */
export function refOf(value: TofuObject): string | undefined {
  const text = formText(value, "$ref");
  return text !== undefined && refParts(text) !== undefined ? text : undefined;
}

/** This function gives the name of a correct variable form, `{ "$var": "name" }`. */
export function varOf(value: TofuObject): string | undefined {
  const text = formText(value, "$var");
  return text !== undefined && NAME_FORM.test(text) ? text : undefined;
}

/** This function gives the name of a correct parameter form, `{ "$param": "name" }`. Only a resource of a group can have one. */
export function paramOf(value: TofuObject): string | undefined {
  const text = formText(value, "$param");
  return text !== undefined && NAME_FORM.test(text) ? text : undefined;
}

/**
 * This function escapes the template sequences of a text. OpenTofu then reads the text as it is in the record.
 * `$${` is the escape of `${`, and `%%{` is the escape of `%{`.
 */
export function escapeTemplate(text: string): string {
  // A function gives each replacement: in a replacement text, `$$` is the escape of one `$`.
  return text.replaceAll("${", () => "$${").replaceAll("%{", () => "%%{");
}

/**
 * This function gives a value as OpenTofu reads it in a JSON file.
 *
 * - A text and each key of an object are escaped.
 * - A reference form becomes the expression of the attribute, and a variable form the expression of the variable.
 *
 * A form that is not correct stays an object with an escaped key. The gate `checkTofu` refuses such a layer.
 */
export function renderValue(value: TofuValue): TofuValue {
  if (typeof value === "string") return escapeTemplate(value);
  if (isList(value)) return value.map(renderValue);
  if (!isObject(value)) return value;
  const ref = refOf(value);
  if (ref !== undefined) return `\${${ref}}`;
  const variable = varOf(value);
  if (variable !== undefined) return `\${var.${variable}}`;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [escapeTemplate(key), renderValue(item)]));
}

/** A place in a value: the keys and the positions from the value to the place. */
export type ValuePath = readonly (string | number)[];

/** A form of a value, with its place. `text` is absent when the form is not correct. */
export interface FormUse {
  readonly kind: "ref" | "var" | "bad";
  readonly path: ValuePath;
  readonly text?: string | undefined;
}

/** One number of a value that is not finite, with its place. */
export interface NumberUse {
  readonly path: ValuePath;
  readonly value: number;
}

/** The forms and the numbers that are not finite of a value. */
export interface ValueUses {
  readonly forms: readonly FormUse[];
  readonly numbers: readonly NumberUse[];
}

/** This function gives each form of a value and each number that is not finite, in the sequence of the value. */
export function valueUses(value: TofuValue): ValueUses {
  const forms: FormUse[] = [];
  const numbers: NumberUse[] = [];
  const walk = (item: TofuValue, path: ValuePath): void => {
    if (typeof item === "number") {
      if (!Number.isFinite(item)) numbers.push({ path, value: item });
      return;
    }
    if (isList(item)) {
      item.forEach((child, index) => {
        walk(child, [...path, index]);
      });
      return;
    }
    if (!isObject(item)) return;
    if (isForm(item)) {
      const ref = refOf(item);
      const variable = varOf(item);
      if (ref !== undefined) forms.push({ kind: "ref", path, text: ref });
      else if (variable !== undefined) forms.push({ kind: "var", path, text: variable });
      else forms.push({ kind: "bad", path });
      return;
    }
    for (const [key, child] of Object.entries(item)) walk(child, [...path, key]);
  };
  walk(value, []);
  return { forms, numbers };
}

/** This function gives a place in a value as a text, for example `disk.0.size`. The place of the value is `(the value)`. */
export function pathText(path: ValuePath): string {
  return path.length === 0 ? "(the value)" : path.join(".");
}
