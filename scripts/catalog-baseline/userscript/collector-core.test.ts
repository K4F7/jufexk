import { describe, expect, it } from "vitest";
import { CollectorEngine, DirectoryUnavailableError, assertSnapshotSafe, buildFormBody, buildPageRequest, createCollectorState, type CollectorDependencies, type CollectorQuery, type PageResponse } from "./collector-core";

function page(current: number, total: number, records = total * 100, status = 200, url = "https://jwxt.jxufe.edu.cn/taglib/DataTable.jsp", rowCount = records === 0 ? 0 : current < total ? 100 : Math.max(0, records - 100 * (total - 1))): PageResponse {
  const rows=Array.from({length:rowCount},()=>"<tr><td>record</td></tr>").join("");
  return { status, url, headers: {}, bytes: new TextEncoder().encode(`<table id="keywords"><tbody>${rows}</tbody></table><script>parent.showTotalRecord('5327042','${records}');reloadPage('/taglib/DataTable.jsp',${total},${current});</script>`) };
}

function query(): CollectorQuery {
  return { schemaVersion:"catalog-capture-package/v1", queryId:"main-2026-0-05-2025", kind:"main", dimensions:{semester:"2026,0",educationLevel:"05",grade:"2025"}, filters:{}, requestParameters:{}, status:"pending", declaredRecordCount:0, capturedRecordCount:0, pageCount:0, nextPage:1, attempts:0 };
}

function harness(responses: Array<PageResponse | Error>) {
  const writes:string[]=[]; const resets:string[]=[]; const checkpoints:any[]=[]; const sleeps:number[]=[]; let index=0;
  const dependencies:CollectorDependencies={
    request:async()=>{const value=responses[index++]; if(value instanceof Error) throw value; return value;},
    writeSnapshot:async(id,p)=>{writes.push(`${id}:${p}`);},
    resetQuerySnapshots:async(id)=>{resets.push(id);},
    saveCheckpoint:async(state)=>{checkpoints.push(structuredClone(state));},
    sleep:async(ms)=>{sleeps.push(ms);}, now:()=>"2026-07-28T00:00:00.000Z", random:()=>0,
  };
  return {engine:new CollectorEngine(dependencies),writes,resets,checkpoints,sleeps};
}

describe("collector engine",()=>{
  it("explicitly resets KINGOSOFT session pagination for the first page",()=>{
    const first=buildPageRequest(query(),1,1462);const later=buildPageRequest(query(),22,1462);
    expect(first.endpoint).toBe("/taglib/DataTable.jsp?tableId=5327042&clientWidth=1462");expect(first.requestParameters).toEqual({initQry:"0"});
    expect(later.endpoint).toBe("/taglib/DataTable.jsp?currPageCount=22");expect(later.requestParameters).toEqual({tableId:"5327042",clientWidth:"1462",initQry:"0"});
  });

  it("reproduces the native GBK form markers without adding pagination fields to the body",()=>{
    const body=buildFormBody({initQry:"0",xnxq:"2025,2",sel_pycc:"05"});
    expect(body).toBe("initQry=0&xnxq=2025%2C2&btnFilter=%C0%E0%B1%F0%B9%FD%C2%CB&btnSubmit=%CC%E1%BD%BB&sel_pycc=05");
  });
  it("captures pages serially and resumes without repeating completed pages",async()=>{
    const first=harness([page(1,2)]); const state=createCollectorState("pilot",[query()]);
    first.engine.pause(); await first.engine.run(state);
    expect(first.writes).toEqual([]);
    first.engine.resume(); first.engine.pause = first.engine.pause.bind(first.engine);
    const second=harness([page(1,2),page(2,2)]); await second.engine.run(state);
    expect(second.writes).toEqual(["main-2026-0-05-2025:1","main-2026-0-05-2025:2"]);
    expect(state.phase).toBe("complete");
    const resumed=harness([]); await resumed.engine.run(state); expect(resumed.writes).toEqual([]);
  });

  it("paces every successful request, including the final page of a query",async()=>{
    const h=harness([page(1,1)]);const state=createCollectorState("pilot",[query()]);await h.engine.run(state);
    expect(h.sleeps).toEqual([400]);
  });

  it("takes a ten-second safety pause after every hundred successful pages",async()=>{
    const h=harness([page(1,1)]);const state=createCollectorState("pilot",[query()]);state.pagesSinceLongPause=99;await h.engine.run(state);
    expect(h.sleeps).toEqual([10_000]);expect(state.pagesSinceLongPause).toBe(0);
  });

  it("captures KINGOSOFT's empty-result response as one auditable raw page",async()=>{
    const h=harness([page(1,0,0)]);const state=createCollectorState("empty",[query()]);await h.engine.run(state);
    expect(h.writes).toEqual(["main-2026-0-05-2025:1"]);expect(state.queries[0]).toMatchObject({status:"complete",declaredRecordCount:0,pageCount:1,nextPage:2});
  });

  it("pauses safely when the session expires",async()=>{
    const h=harness([page(1,1,0,200,"https://jwxt.jxufe.edu.cn/cas/login.action")]); const state=createCollectorState("pilot",[query()]);
    await h.engine.run(state); expect(state.phase).toBe("session_expired"); expect(state.queries[0].nextPage).toBe(1);
    const resumed=harness([page(1,1)]);await resumed.engine.run(state);expect(resumed.writes).toEqual(["main-2026-0-05-2025:1"]);expect(state.phase).toBe("complete");
  });

  it("retries transient errors without restarting the query",async()=>{
    const h=harness([new Error("timeout"),page(1,2),page(2,2)]); const state=createCollectorState("pilot",[query()]);
    await h.engine.run(state); expect(h.writes).toHaveLength(2); expect(state.queries[0].attempts).toBe(1); expect(h.sleeps[0]).toBe(1700);
  });

  it("opens the circuit after consecutive server failures",async()=>{
    const h=harness([page(1,1,0,500),page(1,1,0,500)]); const state=createCollectorState("pilot",[query()]);
    await h.engine.run(state); expect(state.phase).toBe("circuit_open"); expect(h.writes).toEqual([]);
    const resumed=harness([page(1,1)]);await resumed.engine.run(state);expect(resumed.writes).toEqual(["main-2026-0-05-2025:1"]);expect(state.phase).toBe("complete");
  });

  it("honors a bounded 429 backoff and resumes the same page",async()=>{
    const throttled=page(1,1,0,429);throttled.headers["retry-after"]="1";
    const h=harness([throttled,page(1,1)]);const state=createCollectorState("pilot",[query()]);await h.engine.run(state);
    expect(h.sleeps[0]).toBe(60_000);expect(h.writes).toEqual(["main-2026-0-05-2025:1"]);expect(state.phase).toBe("complete");
  });

  it("keeps the page pending when directory permission is lost",async()=>{
    const h=harness([page(1,1)]); h.engine = new CollectorEngine({...((h.engine as any).dependencies), writeSnapshot:async()=>{throw new DirectoryUnavailableError("permission lost");}});
    const state=createCollectorState("pilot",[query()]); await h.engine.run(state); expect(state.phase).toBe("directory_unavailable"); expect(state.queries[0].nextPage).toBe(1);
    const resumed=harness([page(1,1)]);await resumed.engine.run(state);
    expect(resumed.writes).toEqual(["main-2026-0-05-2025:1"]);expect(state.phase).toBe("complete");
  });

  it("runs unattended to a terminal state while isolating an exhausted query",async()=>{
    const first=query();
    const second={...query(),queryId:"main-2025-2-05-2024",dimensions:{semester:"2025,2",educationLevel:"05",grade:"2024"}};
    const h=harness([new Error("timeout"),new Error("timeout"),new Error("timeout"),new Error("timeout"),page(1,1)]);
    const state=createCollectorState("matrix",[first,second]);await h.engine.run(state);
    expect(state.phase).toBe("complete");expect(state.queries.map((item)=>item.status)).toEqual(["exception","complete"]);
    expect(h.writes).toEqual(["main-2025-2-05-2024:1"]);expect(state.log.some((item)=>item.event==="coverage_exception")).toBe(true);
  });

  it("continues after a browser restart without requesting a completed page",async()=>{
    const state=createCollectorState("pilot",[query()]);state.phase="running";state.queries[0].pageCount=2;state.queries[0].declaredRecordCount=150;state.queries[0].capturedRecordCount=100;state.queries[0].nextPage=2;
    const requested:number[]=[];const h=harness([page(2,2,150)]);(h.engine as any).dependencies.request=async(_query:CollectorQuery,pageNumber:number)=>{requested.push(pageNumber);return page(2,2,150);};
    await h.engine.run(state);expect(requested).toEqual([2]);expect(h.writes).toEqual(["main-2026-0-05-2025:2"]);expect(state.phase).toBe("complete");
  });

  it("restarts only the affected query after invalid pagination and records a second failure as an exception",async()=>{
    const invalid={...page(1,1),bytes:new TextEncoder().encode("<html>missing metadata</html>")};
    const recovered=harness([invalid,page(1,1)]);const recoveredState=createCollectorState("pilot",[query()]);await recovered.engine.run(recoveredState);
    expect(recovered.writes).toEqual(["main-2026-0-05-2025:1"]);expect(recoveredState.queries[0].status).toBe("complete");
    const failed=harness([invalid,invalid]);const failedState=createCollectorState("pilot",[query()]);await failed.engine.run(failedState);
    expect(failedState.queries[0].status).toBe("exception");expect(failedState.log.some(item=>item.event==="coverage_exception")).toBe(true);
  });

  it("restarts only the affected query when accumulated page rows do not equal the declared total",async()=>{
    const first=page(1,2,150);const shortFinal=page(2,2,150,200,"https://jwxt.jxufe.edu.cn/taglib/DataTable.jsp",49);
    const h=harness([first,shortFinal,first,shortFinal]);const state=createCollectorState("row-mismatch",[query()]);await h.engine.run(state);
    expect(h.resets).toEqual(["main-2026-0-05-2025"]);expect(h.writes).toEqual(["main-2026-0-05-2025:1","main-2026-0-05-2025:1"]);
    expect(state.queries[0]).toMatchObject({status:"exception",nextPage:2,capturedRecordCount:100,lastError:"query row count mismatch: expected 150, received 149"});
  });

  it("rejects credentials and cross-origin URLs before a snapshot is written",()=>{
    expect(()=>assertSnapshotSafe(new TextEncoder().encode("Cookie: secret"))).toThrow(/unsafe/i);
    expect(()=>assertSnapshotSafe(new TextEncoder().encode("https://evil.example/collect"))).toThrow(/cross-origin/i);
  });
});
