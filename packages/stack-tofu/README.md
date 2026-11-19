# @mark1russell7/stack-tofu

OpenTofu files from the records of a system stack. The package has a generator of the files and two gates. One gate holds a cost limit for each account, and one examines a plan.

It is the OpenTofu add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). The core knows only parts and needs. This package tells how a part becomes a resource of [OpenTofu](https://opentofu.org/).

Nobody writes the files by hand. The files are a result of a query over the records, so they change when the stack changes.

The package knows no provider: the type of a resource and its arguments are data. Each function is a plain function with no clock, no network and no file.

## The rule

A resource has a cost in each month. The gate adds the planned cost of the resources of each account. It fails when an account has no hard limit, and when the planned cost is more than the limit.

The generator starts with the gate. A layer with an error gives no document. Thus a configuration above its cost limit stops before OpenTofu makes a plan.

A plan has its own gate. That gate fails when the plan destroys a resource that must stay, and when it changes a resource that no record has.

A gate that cannot read its input does not pass. An account with no budget is a fault, and a plan in an unknown format is a fault.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-tofu` | The records of a layer, the queries, the cost of each account, the gate, the generator, the gate of a plan and a sample. |
| `@mark1russell7/stack-tofu/schema` | `tofuSchema` and `planSchema`, the zod schemas of a layer and of a plan, with `parseTofu` and `parsePlan`. |
| `@mark1russell7/stack-tofu/add-on` | `tofuAddOn`, the add-on in the form of the layer contract of the core. |

The root entry has no schema library. Thus a page that only shows a document gets no zod.

## Install

```sh
npm install @mark1russell7/stack-tofu @mark1russell7/system-stack
```

## A layer

An OpenTofu layer is one record with the resources of the parts, their providers and the variables. Its format has the name `tofu/1`. A stack keeps it in `Stack.layers`, with the key `tofu/1`.

```ts
import type { TofuLayer } from "@mark1russell7/stack-tofu";

const layer: TofuLayer = {
  schema: "tofu/1",
  version: ">= 1.8",
  providers: [{ name: "example", source: "example-org/example", version: "~> 2.0", part: "cloud-account", values: { token: { $var: "example_token" } } }],
  variables: [{ name: "example_token", sensitive: true, description: "The token of the account of the cloud provider" }],
  resources: [
    { part: "cloud-host", type: "example_disk", values: { size_gb: 10 }, cost: 1, keep: true },
    {
      part: "cloud-host",
      type: "example_server",
      values: { name: "alerts", size: "small", disk: { $ref: "example_disk.cloud-host.id" } },
      cost: 6,
      keep: true,
      ignore: ["labels"],
    },
    { part: "cloud-host", type: "example_firewall", values: { server: { $ref: "example_server.cloud-host.id" }, ports: [22, 443] }, cost: 0 },
    { part: "program-cloud", type: "terraform_data", values: { input: { release: "1.4.0" } } },
  ],
};
```

`SAMPLE_TOFU` of the package is this layer. It is for `SAMPLE_STACK` of the core. Each name and each amount is an example: the provider `example` does not exist.

| Field of a resource | What it is |
| --- | --- |
| `part` | The `id` of the part of the stack that the resource makes. One part can have two resources or more. |
| `type` | The type of the resource, for example `example_server`. |
| `name` | The name of the resource in the files. The default comes from the `id` of the part. |
| `provider` | The provider configuration of the resource. The default is the configuration with no alias whose name starts the type. |
| `values` | The arguments of the resource. |
| `cost` | The planned cost of the resource in a month. It is the standing price. The cost that grows with the use is not in it. |
| `keep` | `true`: the resource holds data or a name that must stay. |
| `ignore` | The attributes whose changes outside the files are permitted. A path can name one key of a map in quotes, for example `metadata["ssh-keys"]`. |
| `import` | The id of an object that exists at the provider. The files import the object as this resource. |

| Field of a provider configuration | What it is |
| --- | --- |
| `name` | The local name of the provider. It is the first word of the types of its resources. |
| `source` | The address of the provider in a registry, for example `example-org/example`. |
| `version` | The versions of the provider that the files accept, for example `~> 2.0`. |
| `alias` | The alias of the configuration, when a provider has two configurations or more. |
| `part` | The `id` of the part that pays for the resources of the configuration: an account, a project or a tenant. |
| `values` | The arguments of the configuration. |

| Field of a variable | What it is |
| --- | --- |
| `name` | The name of the variable. |
| `type` | `string`, `number` or `bool`. The default is `string`. |
| `sensitive` | `true`: OpenTofu does not show the value. |
| `description` | A text for the person who gives the value. |

A secret is a variable, so no record holds its value. A variable has no default for that reason. A person or a program gives each value when OpenTofu runs.

A resource whose type starts with `terraform_` is a part of OpenTofu, for example `terraform_data`. It has no provider configuration, no account and no cost.

The field `backend` of a layer names the place where OpenTofu keeps its state. Each value of a backend is literal.

## The values

An argument is a value of JSON. Three forms have a meaning.

| Value | What OpenTofu reads |
| --- | --- |
| A text | The text as it is in the record. The generator escapes each template sequence. |
| `{ "$ref": "example_disk.cloud-host.id" }` | The attribute `id` of the resource `example_disk.cloud-host` of the layer. |
| `{ "$var": "example_token" }` | The value of the variable `example_token` of the layer. |

A text of a record is thus not an expression. A text with `${` in it stays that text, and it cannot read a file or a secret.

```ts
import { renderValue } from "@mark1russell7/stack-tofu";

renderValue({ name: "a ${literal} text", disk: { $ref: "example_disk.cloud-host.id" }, token: { $var: "example_token" } });
// => { name: "a $${literal} text", disk: "${example_disk.cloud-host.id}", token: "${var.example_token}" }
```

A key that starts with `$` has no other use. The gate refuses an object with such a key that is not one of the two forms. A resource of a group also has the parameter form, `{ "$param": "zone" }`.

## Groups of resources

A group is one record for some resources that go together, for example a server, its disk and its firewall. A copy makes the resources of a group for one part. Thus a second host is one copy, not a second list of resources.

```ts
import type { TofuLayer } from "@mark1russell7/stack-tofu";

const hosts: TofuLayer = {
  schema: "tofu/1",
  providers: [
    { name: "example", source: "example-org/example", part: "cloud-account" },
    { name: "example", alias: "east", source: "example-org/example", part: "cloud-account" },
  ],
  resources: [],
  groups: [
    {
      name: "host",
      params: [{ name: "zone" }, { name: "size", default: "small" }],
      resources: [
        { name: "disk", type: "example_disk", values: { zone: { $param: "zone" } }, cost: 1, keep: true },
        { name: "server", type: "example_server", values: { size: { $param: "size" }, disk: { $ref: "example_disk.disk.id" } }, cost: 6 },
      ],
    },
  ],
  copies: [
    { part: "cloud-host", group: "host", name: "west", values: { zone: "west" } },
    { part: "cloud-host-2", group: "host", name: "east", values: { zone: "east", size: "large" }, providers: ["example.east"] },
  ],
};
// The copy "west" makes example_disk.west_disk and example_server.west_server. Its server reads example_disk.west_disk.id.
```

| Field of a group | What it is |
| --- | --- |
| `name` | The name of the group. |
| `params` | The parameters. Each one has a `name`, and it can have a `default` and a `description`. |
| `resources` | The resources. Each one has a local `name` and a `type`. It has the other fields of a resource, but not `part` and `import`. |

| Field of a copy | What it is |
| --- | --- |
| `part` | The `id` of the part that the resources of the copy make. |
| `group` | The name of the group. |
| `name` | The name of the copy. The default comes from the `id` of the part. |
| `values` | The value of each parameter. A parameter with a default can have no value here. |
| `providers` | Provider configurations, for example `example.east`. Each one replaces the configuration of the group with the same provider name. |

- The name of a resource of a copy is the name of the copy, `_` and the local name.
- A parameter form becomes the value of the copy, or the default of the parameter. The value itself does not change.
- A reference to a local address of the group, for example `example_disk.disk.id`, reads the resource of the same copy.
- A reference to a different address reads a resource of the layer, for example a network for each copy.

`layerResources(layer)` gives the resources of the layer and then the resources of each copy. The gate, the cost of each account, the queries and the generator read the resources through it. Thus a copy counts against the hard limit of its account, and its resources wait for the needs of its part.

A group with no copy makes no resource. Thus a group can hold a host for a later day, with no cost.

## The sequence of the resources

A person writes each dependence one time: in the needs of the stack. `dependsOn(layer, stack)` gives the dependencies of each resource from those needs.

- A resource depends on the resources of each part that its part needs.
- For a needed part with no resource, the walk goes on to the needs of that part.
- An address that the arguments of a resource read is not in the list. OpenTofu knows that dependence from the arguments.

In the sample, the part `program-cloud` needs `cloud-host`. Thus the resource that starts the program waits for the server, the disk and the firewall.

`resourceCycles(layer, stack)` gives the resources that wait for each other. `resourcesByPart(layer)` gives the addresses of the resources of each part, so a host joins a plan or a state to the parts.

## The gate

`checkTofu(layer, stack, { budgets })` gives the faults of a layer. A list with no error tells that the gate passes.

A budget is the hard limit of the cost of an account in a month. The states of a spend layer have this form, so a host gives `serviceStates` of [`@mark1russell7/stack-spend`](../stack-spend/README.md) as the budgets. The two add-ons do not know each other.

```ts
import { checkTofu, SAMPLE_BUDGETS, SAMPLE_TOFU } from "@mark1russell7/stack-tofu";
import { SAMPLE_STACK } from "@mark1russell7/system-stack";

checkTofu(SAMPLE_TOFU, SAMPLE_STACK, { budgets: SAMPLE_BUDGETS });
// => []: the planned cost of the cloud account is 7, and its hard limit is 10

checkTofu(SAMPLE_TOFU, SAMPLE_STACK, { budgets: [{ part: "cloud-account", hardLimit: 5 }], currency: "USD" }).map((fault) => `${fault.code}: ${fault.message}`);
// => ['cost-over: The planned cost of the resources of "cloud-account" is 7 USD for a month. Its hard limit is 5 USD.']

checkTofu(SAMPLE_TOFU, SAMPLE_STACK).map((fault) => fault.code);
// => ["budget-none"]: the gate has no read of the limit of the account
```

| Code | The fault |
| --- | --- |
| `version` | The versions of OpenTofu do not have the form of a list of versions. |
| `backend` | The type of the backend does not have the form of a type, or a value of the backend is not literal. |
| `variable-form` | The name of a variable does not have the form of a name. |
| `variable-duplicate` | Two variables have one name. |
| `provider-form` | The name, the alias, the source or the versions of a provider configuration do not have their form. |
| `provider-duplicate` | Two provider configurations have one address. |
| `provider-source` | Two configurations of one provider have different sources or versions. |
| `provider-part` | A provider configuration names no part of the stack. |
| `provider-value` | A value of a provider configuration reads a resource. |
| `resource-form` | The type, the name or the import id of a resource does not have its form. |
| `resource-duplicate` | Two resources have one address. |
| `resource-part` | A resource names no part of the stack. |
| `provider-none` | The layer does not have the provider configuration of a resource. |
| `ignore-form` | An attribute of `ignore` does not have the form of a path. |
| `value-name` | The name of an argument does not have the form of a name. |
| `value-meta` | An argument is a meta-argument, for example `lifecycle`. The generator writes each meta-argument. |
| `value-form` | An object has a key that starts with `$`, and it is not a correct reference or variable. |
| `value-number` | A number is not finite. JSON cannot hold it. |
| `ref-none` | A reference names a resource that the layer does not have. |
| `var-none` | A value names a variable that the layer does not have. |
| `cycle` | Resources wait for each other, so OpenTofu can make none of them. |
| `cost-amount` | The planned cost of a resource is less than 0 or not finite. |
| `cost-none` | A resource of a provider has no planned cost. A cost that is not known is not 0. |
| `cost-builtin` | A resource that is a part of OpenTofu has a planned cost above 0. It counts against no account. |
| `budget-duplicate` | Two budgets name one part. |
| `budget-amount` | The hard limit of a budget is less than 0 or not finite. |
| `budget-none` | No budget names an account with resources. |
| `limit-none` | The resources of an account have a planned cost above 0, and the account has no hard limit. |
| `cost-over` | The planned cost of an account is more than its hard limit. |
| `provider-need` | A warning: the part of a resource does not need the part of its provider configuration. |
| `variable-unused` | A warning: no value reads a variable. |
| `group-form` | The name of a group, of a parameter or of a copy does not have the form of a name, or a group has no resource. |
| `group-duplicate` | Two groups, two parameters of a group, two local addresses of a group or two copies have one name. |
| `group-shadow` | A local address of a group is the address of a resource of the layer. |
| `group-none` | A copy names a group that the layer does not have. |
| `param-none` | A parameter form names a parameter that its group does not have. |
| `param-missing` | A copy gives no value for a parameter with no default. |
| `param-unknown` | A copy gives a value for a parameter that its group does not have. |
| `copy-provider` | A configuration of a copy replaces no configuration of its group, or two of them have one provider name. |
| `group-unused` | A warning: no copy names a group. |
| `param-unused` | A warning: no resource of a group reads a parameter. |

A fault has the address of its record in the field `at`, and the `id` of the part of the stack in the field `part`. The address of a group is `group.<name>`, and that of a copy is `copy.<name>`. A fault of a resource of a copy has the address of that resource.

The gate does not examine the stack. `checkStack` of the core does, and the generator uses the two functions.

## The cost of each account

`accountStates(layer, budgets)` gives the planned cost of each account, from one Vex formula for each field. A page shows the same numbers that the gate examines.

```ts
import { accountStates, plannedTotal, SAMPLE_BUDGETS, SAMPLE_TOFU } from "@mark1russell7/stack-tofu";

accountStates(SAMPLE_TOFU, SAMPLE_BUDGETS);
// => [{
//   part: "cloud-account",
//   resources: ["example_disk.cloud-host", "example_firewall.cloud-host", "example_server.cloud-host"],
//   planned: 7, unknown: 0, limit: 10, over: false, room: 3,
// }]

plannedTotal(SAMPLE_TOFU); // => 7
```

| Field of a state | What it is |
| --- | --- |
| `resources` | The addresses of the resources that count against the account. |
| `planned` | The sum of the planned costs of those resources in a month. |
| `unknown` | The count of the resources with no planned cost. The sum does not have them. |
| `limit` | The hard limit of the budget of the account. It is absent when no budget gives a correct amount. |
| `over` | If the planned cost is more than the limit. It is absent when the limit is absent. |
| `room` | The limit minus the planned cost. It is absent when the limit is absent. |

A planned cost that is equal to the limit is not over it.

## The generator

`generateTofu(layer, stack, { budgets })` gives the document of the files. It examines the stack and the layer first, and an error gives no document. A warning does not stop it.

```ts
import { DOCUMENT_FILE, documentText, generateTofu, SAMPLE_BUDGETS, SAMPLE_TOFU } from "@mark1russell7/stack-tofu";
import { SAMPLE_STACK } from "@mark1russell7/system-stack";

const made = generateTofu(SAMPLE_TOFU, SAMPLE_STACK, { budgets: SAMPLE_BUDGETS });
if (made.ok) documentText(made.document); // The text of the file DOCUMENT_FILE, "main.tf.json"

generateTofu(SAMPLE_TOFU, SAMPLE_STACK, { budgets: [{ part: "cloud-account", hardLimit: 5 }] });
// => { ok: false, faults: [{ level: "error", code: "cost-over", at: "cloud-account", ... }] }
```

The document is one file in the JSON form of OpenTofu. This is a piece of the document of the sample:

```json
{
  "//": "The generator of @mark1russell7/stack-tofu made this file from the records of a stack. Do not edit it: change the records, and generate it again.",
  "terraform": {
    "required_version": ">= 1.8",
    "required_providers": { "example": { "source": "example-org/example", "version": "~> 2.0" } }
  },
  "variable": {
    "example_token": { "type": "string", "description": "The token of the account of the cloud provider", "sensitive": true }
  },
  "provider": { "example": [{ "token": "${var.example_token}" }] },
  "resource": {
    "example_server": {
      "cloud-host": {
        "//": "The part \"cloud-host\" of the stack.",
        "name": "alerts",
        "size": "small",
        "disk": "${example_disk.cloud-host.id}",
        "lifecycle": { "prevent_destroy": true, "ignore_changes": ["labels"] }
      }
    },
    "terraform_data": {
      "program-cloud": {
        "//": "The part \"program-cloud\" of the stack.",
        "input": { "release": "1.4.0" },
        "depends_on": ["example_disk.cloud-host", "example_firewall.cloud-host", "example_server.cloud-host"]
      }
    }
  }
}
```

- The same records give the same text, in each sequence of the records. Thus a change of the file in a review is a change of the records.
- The arguments of a resource keep the sequence of the record.
- A resource with `keep` gets `prevent_destroy`, so OpenTofu refuses a plan that destroys it.
- A resource with `import` gets an `import` block, so OpenTofu takes the object that exists.
- Each resource has a comment with the `id` of its part.

The generator writes no file. The host writes the text, because only the host knows the folder.

## The gate of a plan

OpenTofu makes a plan from the files and the state. `checkPlan(layer, plan, options)` gives the faults of the JSON of that plan, from the command `tofu show -json`. An empty list tells that the gate passes.

```ts
import { checkPlan, SAMPLE_PLAN, SAMPLE_TOFU } from "@mark1russell7/stack-tofu";

checkPlan(SAMPLE_TOFU, SAMPLE_PLAN);
// => []: the first plan makes each resource of the layer

checkPlan(SAMPLE_TOFU, SAMPLE_PLAN, { noChange: true }).map((fault) => fault.code);
// => ["plan-change", "plan-change", "plan-change", "plan-change"]
```

| Code | The fault |
| --- | --- |
| `plan-format` | The format of the plan has a different major version. The gate reads nothing more. |
| `plan-errored` | The plan has an error, so it is not complete. |
| `plan-action` | A change has an action that the gate does not know, or no action. |
| `plan-unknown` | The plan changes a resource that the layer does not have. No record tells its cost. |
| `plan-missing` | The plan does not have a resource of the layer. The plan is not a plan of these records. |
| `plan-destroy` | The plan deletes or replaces a resource whose record has `keep`. |
| `plan-delete` | The plan deletes a resource, and the option `removes` does not name it. |
| `plan-forget` | The plan removes a resource from the state and does not delete it. The object stays at the provider with no record. |
| `plan-import` | The import of a resource in the plan and the field `import` of its record do not agree. |
| `plan-change` | The option `noChange` is set, and the plan changes a resource. |

| Option | What it does |
| --- | --- |
| `noChange` | `true`: each change of a resource is a fault. Use it for the plan after an import, and for a check that the files and the state agree. |
| `removes` | The addresses of the resources that the plan can delete. |

A delete is thus a decision of a person. The person removes the record and names the address in `removes` for one run.

## The steps of a run

The package has no command and no network. A host does these steps.

1. Read the records, and use `generateTofu` with the budgets. Stop when it gives no document.
2. Write the text of the document to `main.tf.json` in an empty folder.
3. Start `tofu init`, then `tofu plan -out=plan.bin`.
4. Start `tofu show -json plan.bin`, and read the output with `parsePlan`.
5. Examine the plan with `checkPlan`. Stop when it gives a fault.
6. Start `tofu apply plan.bin`.

To take an object that exists, put its id in the field `import` of the record. Then do steps 1 to 5 with the option `noChange`. A plan with no change tells that the record and the object agree.

Do not keep a state file of OpenTofu in a public repository: it can hold secrets.

## The check with a real OpenTofu

The file `e2e/tofu.e2e.ts` does these steps with a real OpenTofu. The job `tofu` of the CI workflow starts it for each pull request. Each resource of the check is a `terraform_data`, so the check needs no provider and no account.

The check holds these facts:

- OpenTofu accepts the files of the generator, with no warning.
- A literal text with `${` or `%{` comes back as the record has it.
- A plan has one change with the action `no-op` for each resource that stays the same.
- A delete of a resource stops the gate until the option `removes` names its address.
- OpenTofu refuses a plan that replaces a resource with `keep`.
- An import of an object that exists gives a plan with no change.

To start the check on your computer, install OpenTofu. Then start `pnpm --filter @mark1russell7/stack-tofu run test:tofu`.

## The read of JSON

`parseTofu` and `parsePlan` of the entry `/schema` read the JSON of a layer and of a plan. Each gives its record, or the faults of the form with the place of each fault.

```ts
import { parseTofu } from "@mark1russell7/stack-tofu/schema";

parseTofu({ schema: "tofu/1", resources: [{ part: "cloud-host", type: 5 }] });
// => { ok: false, errors: ['The record "tofu/1" has a fault at "resources.0.type": Invalid input: expected string, received number'] }
```

The schema of a layer refuses a field that the format does not have. The schema of a plan keeps each field that it does not know, because a later version of OpenTofu can add fields.

The schema examines the form of a record. `checkTofu` and `checkPlan` examine the meaning of a record with a correct form.

## What the format does not have

The format `tofu/1` has resources, provider configurations, variables, one backend and imports. It does not have these parts of the language:

- Data sources, modules and outputs.
- The meta-arguments `count` and `for_each`, and provisioners.
- A default value of a variable.

A group and its copies do the work of a module and of `for_each` in the records. The files have each resource of each copy, so a plan and a state name each one.

A plan with a data source or a module gives the fault `plan-unknown`.

## The resources of some owners

`joinTofu(pieces)` joins the OpenTofu layers of the fragments of a stack into one layer. A piece is the layer of one fragment, with the name of the fragment.

- The resources, the provider configurations and the variables are in the order of the fragments.
- A resource address in two or more fragments is a fault. Equal resources give the fault too.
- The same rule holds for the address of a provider configuration and for the name of a variable, a group or a copy.
- The layer has one `version`. A fragment with a different value is a fault.
- The state has one place. Thus a `backend` in two or more fragments is a fault.

A resource of one fragment can use a provider configuration or a variable of a different fragment. A copy can name a group of a different fragment.

```ts
import { joinTofu } from "@mark1russell7/stack-tofu";

const first = { schema: "tofu/1", version: ">= 1.8", backend: { type: "local" }, resources: [{ part: "one", type: "example_server" }] } as const;

joinTofu([
  { from: "a.json", layer: first },
  { from: "b.json", layer: { schema: "tofu/1", resources: [{ part: "two", type: "example_server" }] } },
]);
// => { ok: true, layer: { schema: "tofu/1", version: ">= 1.8", backend: { type: "local" }, resources: [{ part: "one", type: "example_server" }, { part: "two", type: "example_server" }] } }

joinTofu([
  { from: "a.json", layer: first },
  { from: "b.json", layer: { schema: "tofu/1", version: ">= 1.9", backend: { type: "local" }, resources: [{ part: "one", type: "example_server" }] } },
]);
// => {
//   ok: false,
//   errors: [
//     'The fragment "a.json" has the version of OpenTofu ">= 1.8", and the fragment "b.json" has ">= 1.9".',
//     'The fragments "a.json", "b.json" each have a backend. The state has one place.',
//     'The fragments "a.json", "b.json" each have the resource "example_server.one".',
//   ],
// }
```

The add-on of the entry `/add-on` has the function as `join`. `joinStacks` of the core uses it for a stack in two or more documents, and the gate `checkTofu` examines the joined layer afterward.

The generator sorts the records. Thus it gives the same text of the file for each division of the records into fragments.

## The add-on for one check of a stack

`tofuAddOn` of the entry `/add-on` gives the add-on in the form of the layer contract. A host gives it to `checkStackLayers` of the core, with the add-ons of the other layers. A host with a stack in two or more documents gives it to `joinStacks` first.

```ts
import { tofuAddOn } from "@mark1russell7/stack-tofu/add-on";
import { checkStackLayers } from "@mark1russell7/system-stack";

checkStackLayers(stack, [tofuAddOn({ budgets })]);
// => the faults of the stack, then the faults of `checkTofu` for the layer `tofu/1`, each with the name of its layer
```

A layer with a wrong form gives one finding `layer-form` for each fault of the form, and the gate does not start. The add-on does not read the layer of a different add-on. The host gives the limit of each account as `budgets`, for example from the states of a spend layer.

## License
MIT
