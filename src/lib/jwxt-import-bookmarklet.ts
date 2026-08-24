import { JWXT_IMPORT_HASH_PREFIX } from "./jwxt-schedule-text";

export function isJwxtImportHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "jwxt.jxufe.edu.cn" || host.endsWith(".jwxt.jxufe.edu.cn");
}

/** 在学生已打开的 jwxt 页运行：只回传课表行，不读 Cookie。 */
export function jwxtImportBookmarkletSource(origin: string): string {
  const site = origin.replace(/\/$/, "");
  return `(function(){
  var origin=${JSON.stringify(site)};
  var host=String(location.hostname||"").toLowerCase();
  if (host!=="jwxt.jxufe.edu.cn" && !host.endsWith(".jwxt.jxufe.edu.cn")) {
    alert("请先打开本科教务（jwxt.jxufe.edu.cn）再点这个书签");
    return;
  }
  function docs(root){
    var out=[root];
    var frames=root.querySelectorAll("iframe,frame");
    for (var i=0;i<frames.length;i++){
      try {
        if (frames[i].contentDocument) out=out.concat(docs(frames[i].contentDocument));
      } catch (e) {}
    }
    return out;
  }
  function textOf(el){
    return String((el && (el.innerText || el.textContent)) || "").replace(/\\s+/g," ").trim();
  }
  function headerIndex(cells, names){
    for (var i=0;i<cells.length;i++){
      var t=textOf(cells[i]);
      for (var j=0;j<names.length;j++) if (t.indexOf(names[j])>=0) return i;
    }
    return -1;
  }
  var rows=[];
  docs(document).forEach(function(doc){
    var tables=doc.querySelectorAll("table");
    for (var t=0;t<tables.length;t++){
      var trs=tables[t].querySelectorAll("tr");
      if (!trs.length) continue;
      var heads=trs[0].querySelectorAll("th,td");
      var ci=headerIndex(heads,["课程"]);
      var ti=headerIndex(heads,["上课时间"]);
      if (ci<0||ti<0) continue;
      var ji=headerIndex(heads,["任课教师","教师"]);
      var wi=headerIndex(heads,["周次"]);
      for (var r=1;r<trs.length;r++){
        var cells=trs[r].querySelectorAll("th,td");
        var name=textOf(cells[ci]||{});
        var time=textOf(cells[ti]||{});
        if (!name||!time) continue;
        if (/CASTGC|JSESSIONID|password|passwd|cookie/i.test(name+time)) continue;
        var codeMatch=/^(\\d{8,12})\\s+(.+)$/.exec(name);
        rows.push({
          courseName: codeMatch?codeMatch[2]:name,
          courseCode: codeMatch?codeMatch[1]:"",
          teacherName: ji>=0?textOf(cells[ji]||{}):"",
          weekText: wi>=0?textOf(cells[wi]||{}):"",
          timeText:time
        });
      }
    }
  });
  if (!rows.length){
    alert("当前页没有找到带「上课时间」的课表，请先打开个人课表或选课结果");
    return;
  }
  var json=JSON.stringify({v:1,rows:rows});
  var encoded=btoa(unescape(encodeURIComponent(json)));
  location=origin+"/schedule#${JWXT_IMPORT_HASH_PREFIX}"+encodeURIComponent(encoded);
})()`;
}

export function jwxtImportBookmarkletHref(origin: string): string {
  return `javascript:${encodeURIComponent(jwxtImportBookmarkletSource(origin))}`;
}


/** 在已打开的 jwxt 页导出同一版本化 DTO JSON，不读 Cookie。 */
export function jwxtSnapshotBookmarkletSource(): string {
  return `(function(){
  var host=String(location.hostname||"").toLowerCase();
  if (host!=="jwxt.jxufe.edu.cn" && !host.endsWith(".jwxt.jxufe.edu.cn")) {
    alert("请先打开本科教务（jwxt.jxufe.edu.cn）再点这个书签");
    return;
  }
  function docs(root){
    var out=[root];
    var frames=root.querySelectorAll("iframe,frame");
    for (var i=0;i<frames.length;i++){
      try {
        if (frames[i].contentDocument) out=out.concat(docs(frames[i].contentDocument));
      } catch (e) {}
    }
    return out;
  }
  function textOf(el){
    return String((el && (el.innerText || el.textContent)) || "").replace(/\\s+/g," ").trim();
  }
  function headerIndex(cells, names){
    for (var i=0;i<cells.length;i++){
      var t=textOf(cells[i]);
      for (var j=0;j<names.length;j++) if (t.indexOf(names[j])>=0) return i;
    }
    return -1;
  }
  function optionList(doc, names){
    var selects=doc.querySelectorAll("select");
    var out=[];
    for (var s=0;s<selects.length;s++){
      var name=String(selects[s].getAttribute("name")||selects[s].id||"").toLowerCase();
      var hit=false;
      for (var n=0;n<names.length;n++) if (name.indexOf(names[n])>=0) hit=true;
      if (!hit) continue;
      var opts=selects[s].querySelectorAll("option");
      for (var o=0;o<opts.length;o++){
        var id=opts[o].value||textOf(opts[o]);
        var label=textOf(opts[o])||id;
        if (!id && !label) continue;
        if (/CASTGC|JSESSIONID|password|passwd|cookie|学号|姓名/i.test(id+label)) continue;
        out.push({id:id,label:label});
      }
    }
    return out;
  }
  function meetings(timeText, weekText){
    return [{rawTime:timeText,rawWeek:weekText}];
  }
  var enrolled=[];
  var planned=[];
  var pageText="";
  docs(document).forEach(function(doc){
    pageText += " " + textOf(doc.body||doc.documentElement);
    var tables=doc.querySelectorAll("table");
    for (var t=0;t<tables.length;t++){
      var trs=tables[t].querySelectorAll("tr");
      if (!trs.length) continue;
      var heads=trs[0].querySelectorAll("th,td");
      var ci=headerIndex(heads,["课程"]);
      if (ci<0) continue;
      var ti=headerIndex(heads,["上课时间"]);
      var ji=headerIndex(heads,["任课教师","教师"]);
      var wi=headerIndex(heads,["周次"]);
      var si=headerIndex(heads,["上课班号","班号"]);
      var ki=headerIndex(heads,["课程类别","类别"]);
      var xi=headerIndex(heads,["学分"]);
      var pi=headerIndex(heads,["上课地点"]);
      var cai=headerIndex(heads,["开课校区","校区"]);
      var rows=[];
      for (var r=1;r<trs.length;r++){
        var cells=trs[r].querySelectorAll("th,td");
        var name=textOf(cells[ci]||{});
        if (!name) continue;
        if (/CASTGC|JSESSIONID|password|passwd|cookie|学号|姓名/i.test(name)) return;
        var codeMatch=/^(\\d{8,12})\\s+(.+)$/.exec(name);
        rows.push({
          courseCode: codeMatch?codeMatch[1]:"",
          courseName: codeMatch?codeMatch[2]:name,
          credits: null,
          categoryPath: ki>=0?textOf(cells[ki]||{}):"",
          section: si>=0?textOf(cells[si]||{}):"",
          teacherName: ji>=0?textOf(cells[ji]||{}):"",
          campus: cai>=0?textOf(cells[cai]||{}):"",
          weekText: wi>=0?textOf(cells[wi]||{}):"",
          timeText: ti>=0?textOf(cells[ti]||{}):"",
          place: pi>=0?textOf(cells[pi]||{}):"",
          capacityLimit: null,
          capacitySelected: null,
          capacityAvailable: null,
          enrollStatus: "",
          meetings: [],
          catalogCourseId: null,
          catalogTeacherId: null
        });
      }
      if (!rows.length) continue;
      if (/已选|选课结果/.test(pageText)) enrolled=enrolled.concat(rows);
      else planned=planned.concat(rows);
    }
  });
  if (/登录超时|会话过期|请先登录|cas\\/login/i.test(pageText) && !enrolled.length && !planned.length) {
    alert("教务登录已失效，请重新登录后再导出");
    return;
  }
  if (!enrolled.length && !planned.length){
    alert("当前页没有找到课程表，请先打开选课结果或候选课程");
    return;
  }
  var root=document;
  var terms=optionList(root,["xnxq","xq","term"]);
  var grades=optionList(root,["nj","grade"]);
  var majors=optionList(root,["zy","major"]);
  var levels=optionList(root,["pycc","xslb","level"]);
  var snapshot={
    version:1,
    source:"browser-export",
    term: terms[0]||{id:"",label:""},
    educationLevel: levels[0]||{id:"",label:""},
    grade: grades[0]||{id:"",label:""},
    major: majors[0]||{id:"",label:""},
    terms: terms,
    educationLevels: levels,
    grades: grades,
    majors: majors,
    categories: [],
    enrolled: enrolled,
    planned: planned,
    publicElectives: []
  };
  var blob=new Blob([JSON.stringify(snapshot,null,2)],{type:"application/json"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url;
  a.download="jufexk-jwxt-snapshot.v1.json";
  a.click();
  URL.revokeObjectURL(url);
})()`;
}

export function jwxtSnapshotBookmarkletHref(_origin: string): string {
  return `javascript:${encodeURIComponent(jwxtSnapshotBookmarkletSource())}`;
}
