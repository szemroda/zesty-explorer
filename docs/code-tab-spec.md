# Code tab specification

Status: Approved by the user on 2026-09-25. Implemented on 2026-09-25.

## Audience and outcome

Code helps developers understand Parsley source. Most users have limited or moderate Parsley knowledge, but experienced users also need help navigating large, complex endpoints.

## V1 scope

V1 covers the complete path from entering Code to selecting a file and understanding its source. Calling endpoints is deferred to V2.

The selected presentation is prototype variant D: annotated source, a separate "What this code uses" card, and a separate "How it works" card.

## Entry and navigation

Explorer and Code are separate tabs for the selected instance. Opening Code does not require choosing a collection. Switching tabs preserves the state of both tabs.

Changing the selected instance resets both tabs. V1 does not retain a separate workspace for each previously visited instance.

Code links identify the instance, selected file, and code state. They restore that selection on reload or for another user with their own session token. They contain no source code or credentials and select the current version in that state rather than pinning a historical version. `Copy Code link` is separate from sharing an Explorer view.

Opening a referenced collection presents a dialog explaining that opening it in Explorer will replace the current Explorer view. The actions are `Open in Explorer`, `Open in new tab`, and `Cancel`. Choosing a new tab may require the user to enter their token there.

## File selection

V1 lists all files returned by `/web/views`, without search or filters and without hiding `/z/` paths. Separate `/web/scripts` and `/web/stylesheets` resources are outside V1; a custom file returned by `/web/views` remains in scope regardless of its extension.

## Source versions

Code defaults to `Latest saved` and offers `Published` as an alternative. This choice is independent of Explorer's content state. The source display identifies the selected state and version number. Historical versions and version comparisons are deferred.

If the selected state is unavailable, the application shows that absence and offers an explicit action to view the other state. It never switches states automatically. Snippet navigation preserves the selected code state.

## Included snippets

V1 analyzes each file separately. An include offers navigation to its snippet and a way to return to the call site. The current file's analysis explicitly excludes the contents of included snippets. V1 does not merge dependencies or walkthrough steps across files.

## Analysis uncertainty

Failure to match a source reference to the available collection catalog is not sufficient evidence of a code error. References and source fragments that the application cannot recognize are presented as unrecognized rather than incorrect.

V1 analysis coverage prioritizes the constructs below. This prioritization follows language documentation and prototype capabilities; no measured usage distribution is available.

### Accepted coverage

Recognize nested loops and conditions, loop clauses, assignments and variable references, request inputs, collection and relationship paths, model-bound `this`, includes, and external request calls. Preserve generic method chains, their arguments, and references within expressions. Give focused explanations for `first`, `filter`, `toJSON`, and the common modifiers already explained by variant D.

Other function calls remain visible with their names, arguments, and any resolved references, even when no function-specific explanation exists. Unrecognized syntax is explicitly marked and does not silently disappear from the walkthrough. A partly understood file must not be presented as fully explained.

Defer exhaustive descriptions of specialized helpers, analysis across included files, interpretation of embedded JavaScript/CSS/HTML behavior, and inference or validation of the complete response shape. Static analysis does not evaluate conditions or queries, predict exact response values, or execute remote calls.

The [official Parsley Index](https://docs.zesty.io/docs/parsley-index) documents chained `first` and `filter` calls and the broader helper families. Implementation must account for documented forms within these families, including `sort by` and `order by`, multiple sort fields, and limit offsets. The [variable documentation](https://docs.zesty.io/docs/variables) distinguishes page-load, session, and cookie variables and request inputs; recognizing these references does not reveal their runtime values. A dynamic include remains visible even when its target cannot be resolved to a file.

## Source presentation and interaction

- Provide `Formatted` and `As saved` source presentations with saved and formatted line counts, line numbers, indentation guides, and Parsley syntax highlighting.
- Keep each collection's color consistent across files. Its field tokens use that color. Highlight request parameters and show token tooltips with resolved collection and field labels and useful type or modifier details.
- Present unresolved references neutrally, replacing the prototype's error-like red marking for catalog misses.
- `What this code uses` lists collections and used fields, distinguishes direct loop access from access through relationships, and lists request parameters, variables, snippets, remote requests, and unrecognized references.
- `How it works` appears below the usage card and scrolls independently. It lists source-order steps with nested numbering, author comments, assignments, includes, conditions and branches, and loops with their filtering, sorting, limits, and outputs. Recognized comma-separator boilerplate can be omitted from the walkthrough while remaining visible in source.
- Hovering a reference or step highlights its source lines and dims unrelated lines. Clicking pins the highlight and scrolls to the first relevant line. Clicking a source token also pins its reference. Separate occurrences of identical statements must remain distinguishable.
- Formatting is a display transformation. `As saved` preserves the original text, including when analysis is incomplete. Formatting must not rewrite literal values or pretend to understand unrecognized syntax.

## Source handling

The application remains read-only toward Zesty. Code sources stay in browser memory and never enter shared views, URLs, persisted browser storage, logs, or reports. Code navigation shares identifiers and the selected state, not source text. V1 does not invoke endpoints or execute code found in a file.

## Acceptance criteria

- A user can select an instance, enter Code without a root collection, select any listed file, and inspect its source and analysis.
- Tab switching preserves both tabs' state; an instance change resets both.
- A Code link restores its file and code state after reload or for another authorized user. Missing files and unavailable versions produce explicit states without silently selecting another source.
- `Latest saved` and `Published` select code independently of Explorer content state. Snippet navigation keeps this choice and offers a return to the call site.
- Collection navigation offers the agreed replacement/new-tab/cancel dialog and preserves the existing Explorer view when canceled.
- The agreed Parsley families have focused parser and analysis tests, including nested scopes, method chains, unresolved references, and repeated identical statements.
- A partly understood file remains readable and shows the gaps in its explanation. A catalog lookup failure cannot turn an unresolved reference into a claimed code error.
- Source-to-step highlighting and click-to-scroll work in both source presentations on files longer than the visible panel. Formatted output preserves literals, and original source remains available.

## Language

The interface, source code, repository documentation, errors, and test names use English. User-authored names and labels retain their original text.

## Implementation

The Parsley parser, analysis, and source presentation live in `src/parsley/` and do not depend on React. The Code tab UI is `CodeWorkspace` and `CodeSourceView` in `src/app/components/`, and Code links are encoded in `src/app/code-link.ts`. Browser coverage of the acceptance criteria is in `e2e/code.spec.ts`, using fictional files from `e2e/code-fixtures.ts`.
