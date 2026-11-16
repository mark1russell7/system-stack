# Roadmap

This file is the plan of system-stack. The Status page of the site reads it, and the tracker of the project mirrors it.

| ID | Item | Status | Summary |
| --- | --- | --- | --- |
| R1 | The core: parts, needs and the parts that work | done | `@mark1russell7/system-stack` has the format `stack/1`: each part of a system is a record with its needs. `working` gives the parts that work when some parts are down. `checkStack` finds an unknown part, a duplicate id and parts that need each other. The core names no topic. |
| R2 | The spend add-on: a hard limit for each cost | in progress | `@mark1russell7/stack-spend` has the format `spend/1`: the plan, the price and the limits of the cost of each part. The gate `checkSpend` fails when a cost can grow with no hard limit. An alert is not a limit. `ownerSteps` gives the work of the owner of an account. The next step is a reader of the live cost of each service, with levels at 50, 80 and 100 percent of its limit. |
| R3 | The risk add-on | open | Each risk is a query over the records: the parts whose failure alone stops a function, the smallest sets of parts whose failure stops it, and the probability that it works. |
| R4 | The OpenTofu add-on | open | A generator writes OpenTofu files from the records of a stack. The cost limits of the spend layer are safeties of each resource. |
| R5 | Feeds and a freshness gate | open | A feed reads the facts of a part from its source. A feed of secrets reads only their names. A gate fails when a record is older than its source permits. |
| R6 | A demo on the site | open | The site shows the sample stack. A person puts parts down, and the page shows which functions still work and the cost limit of each account. |
| R7 | One contract for the layers of add-ons | open | Each add-on reads and checks its layer through one shared contract. Thus one function checks all layers of a stack. |
