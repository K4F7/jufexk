import { runLiveLayoutContextIndexCli } from "./live_layout_context_index";

const result = await runLiveLayoutContextIndexCli(process.argv.slice(2));
console.log(JSON.stringify(result));
