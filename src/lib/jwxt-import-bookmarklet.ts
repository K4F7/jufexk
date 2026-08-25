import { JWXT_IMPORT_HASH_PREFIX } from "./jwxt-schedule-text";
import type { JwxtMeeting } from "./jwxt-offering";

export function isJwxtImportHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "jwxt.jxufe.edu.cn" || host.endsWith(".jwxt.jxufe.edu.cn");
}

/** 保持为无外部依赖函数，以便通过 toString 内联进教务页书签。 */
export function parseJwxtBookmarkletMeetings(
  timeText: string,
  weekText: string,
  place: string,
): JwxtMeeting[] {
  const dayMap: Record<string, number> = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7,
  };
  const weeks = new Set<number>();
  const weekSource = weekText.trim() || timeText;
  const rangePattern = weekText.trim()
    ? /(\d{1,2})\s*[-–—~至到]\s*(\d{1,2})/g
    : /(\d{1,2})\s*[-–—~至到]\s*(\d{1,2})\s*周/g;
  let range: RegExpExecArray | null;
  while ((range = rangePattern.exec(weekSource))) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    for (let week = Math.min(start, end); week <= Math.max(start, end); week += 1) {
      if (week >= 1 && week <= 60) weeks.add(week);
    }
  }
  if (weeks.size === 0) {
    const singles = weekText.trim()
      ? weekSource.match(/\d{1,2}/g) ?? []
      : [...weekSource.matchAll(/(\d{1,2})\s*周/g)].map((match) => match[1]);
    for (const token of singles) {
      const week = Number(token);
      if (week >= 1 && week <= 60) weeks.add(week);
    }
  }
  if (weeks.size === 0) {
    for (let week = 1; week <= 16; week += 1) weeks.add(week);
  }
  const parity = /单周|奇数周/.test(weekSource) ? 1 : /双周|偶数周/.test(weekSource) ? 0 : null;
  const normalizedWeeks = [...weeks]
    .filter((week) => parity === null || week % 2 === parity)
    .sort((left, right) => left - right);
  const meetings: JwxtMeeting[] = [];
  const timePattern = /(?:星期|周)([一二三四五六日天])\s*(?:第)?\s*(\d{1,2})(?:\s*[-–—~至]\s*(\d{1,2}))?\s*节/g;
  let time: RegExpExecArray | null;
  while ((time = timePattern.exec(timeText))) {
    const startPeriod = Number(time[2]);
    const endPeriod = Number(time[3] || time[2]);
    if (startPeriod < 1 || endPeriod < startPeriod || endPeriod > 20) continue;
    meetings.push({
      weekday: dayMap[time[1]],
      startPeriod,
      endPeriod,
      weeks: normalizedWeeks,
      place,
    });
  }
  const bracketPattern = /(?:^|[;；\n])\s*(?:(?:\d{1,2}\s*[-–—~至到]\s*\d{1,2}|\d{1,2})\s*周\s*)?(?:星期|周)?([一二三四五六日天])\s*\[\s*(\d{1,2})(?:\s*[-–—~至到]\s*(\d{1,2}))?\s*\]\s*([^;；\n]*)/g;
  while ((time = bracketPattern.exec(timeText))) {
    const startPeriod = Number(time[2]);
    const endPeriod = Number(time[3] || time[2]);
    if (startPeriod < 1 || endPeriod < startPeriod || endPeriod > 20) continue;
    const inlinePlace = time[4].trim();
    meetings.push({
      weekday: dayMap[time[1]],
      startPeriod,
      endPeriod,
      weeks: normalizedWeeks,
      place: inlinePlace || (place === timeText ? "" : place),
    });
  }
  return meetings;
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
    if (typeof el==="string") return el.replace(/\\s*\\n+\\s*/g,"；").replace(/\\s+/g," ").trim();
    return String((el && (el.innerText || el.textContent)) || "").replace(/\\s*\\n+\\s*/g,"；").replace(/\\s+/g," ").trim();
  }
  function headerIndex(cells, names){
    for (var x=0;x<cells.length;x++){
      var exact=textOf(cells[x]);
      for (var y=0;y<names.length;y++) if (exact===names[y]) return x;
    }
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
    if (typeof el==="string") return el.replace(/\\s*\\n+\\s*/g,"；").replace(/\\s+/g," ").trim();
    return String((el && (el.innerText || el.textContent)) || "").replace(/\\s*\\n+\\s*/g,"；").replace(/\\s+/g," ").trim();
  }
  function headerIndex(cells, names){
    for (var x=0;x<cells.length;x++){
      var exact=textOf(cells[x]);
      for (var y=0;y<names.length;y++) if (exact===names[y]) return x;
    }
    for (var i=0;i<cells.length;i++){
      var t=textOf(cells[i]);
      for (var j=0;j<names.length;j++) if (t.indexOf(names[j])>=0) return i;
    }
    return -1;
  }
  function optionList(documents, names){
    var out=[];
    for (var d=0;d<documents.length;d++){
    var selects=documents[d].querySelectorAll("select");
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
        if (opts[o].selected) out.unshift({id:id,label:label});
        else out.push({id:id,label:label});
      }
    }
    }
    return out;
  }
  function tableGrid(table){
    var out=[];
    var spans=[];
    var trs=table.querySelectorAll("tr");
    for (var r=0;r<trs.length;r++){
      var row=[];
      var col=0;
      function carry(){
        while (spans[col]) {
          row[col]=spans[col].text;
          spans[col].left-=1;
          if (spans[col].left<=0) delete spans[col];
          col+=1;
        }
      }
      var cells=trs[r].querySelectorAll("th,td");
      for (var c=0;c<cells.length;c++){
        carry();
        var value=textOf(cells[c]);
        var colspan=Math.max(1,Number(cells[c].getAttribute("colspan")||1));
        var rowspan=Math.max(1,Number(cells[c].getAttribute("rowspan")||1));
        for (var width=0;width<colspan;width++){
          row[col]=value;
          if (rowspan>1) spans[col]={text:value,left:rowspan-1};
          col+=1;
        }
      }
      carry();
      out.push(row);
    }
    return out;
  }
  var meetings=${parseJwxtBookmarkletMeetings.toString()};
  var enrolled=[];
  var planned=[];
  var publicElectives=[];
  var roots=docs(document);
  roots.forEach(function(doc){
    var docUrl="";
    try { docUrl=String(doc.location&&doc.location.href||""); } catch (e) {}
    var tables=doc.querySelectorAll("table");
    for (var t=0;t<tables.length;t++){
      var grid=tableGrid(tables[t]);
      if (!grid.length) continue;
      var headerRow=0;
      while (headerRow<grid.length && headerIndex(grid[headerRow],["课程"])<0) headerRow+=1;
      if (headerRow>=grid.length) continue;
      var courseHeaderColumn=headerIndex(grid[headerRow],["课程名称","课程名","课程"]);
      var headerEnd=headerRow;
      while (headerEnd+1<grid.length && ["课程号","课程代码","课程名称","课程名","课程"].indexOf(textOf(grid[headerEnd+1][courseHeaderColumn]||""))>=0) headerEnd+=1;
      var heads=grid[headerEnd];
      var ci=headerIndex(heads,["课程名称","课程名"]);
      if (ci<0) ci=headerIndex(heads,["课程"]);
      if (ci<0) continue;
      var coi=headerIndex(heads,["课程号","课程代码"]);
      var ti=headerIndex(heads,["上课时间"]);
      var ji=headerIndex(heads,["任课教师","教师"]);
      var wi=headerIndex(heads,["周次"]);
      var si=headerIndex(heads,["上课班级","上课班号","班号"]);
      var ki=headerIndex(heads,["课程类别","类别"]);
      var xi=headerIndex(heads,["学分"]);
      var pi=headerIndex(heads,["上课地点"]);
      var cai=headerIndex(heads,["开课校区","校区"]);
      var cli=headerIndex(heads,["限选人数","人数上限","限选","容量"]);
      var csi=headerIndex(heads,["已选人数","已选/免听","已选"]);
      var cvi=headerIndex(heads,["可选人数","剩余人数","可选","余量"]);
      var ei=headerIndex(heads,["选课状态","状态"]);
      var rows=[];
      for (var r=headerEnd+1;r<grid.length;r++){
        var cells=grid[r];
        var name=textOf(cells[ci]||{});
        if (!name) continue;
        if (/CASTGC|JSESSIONID|password|passwd|cookie|学号|姓名/i.test(name)) return;
        var codeMatch=/^\\[\\s*([A-Za-z0-9._-]{4,32})\\s*\\]\\s*(.+)$/.exec(name)||/^(\\d{8,12})\\s+(.+)$/.exec(name);
        var explicitCode=coi>=0?textOf(cells[coi]||{}):"";
        var weekText=wi>=0?textOf(cells[wi]||{}):"";
        var timeText=ti>=0?textOf(cells[ti]||{}):"";
        var place=pi>=0&&pi!==ti?textOf(cells[pi]||{}):"";
        var parsedMeetings=meetings(timeText,weekText,place);
        if (!place && parsedMeetings.length) place=parsedMeetings[0].place||"";
        function countAt(index){
          var match=index>=0?/\\d+/.exec(textOf(cells[index]||{}).replace(/,/g,"")):null;
          return match?Number(match[0]):null;
        }
        var credits=xi>=0?/\\d+(?:\\.\\d+)?/.exec(textOf(cells[xi]||{})):null;
        rows.push({
          courseCode: explicitCode||(codeMatch?codeMatch[1]:""),
          courseName: codeMatch?codeMatch[2]:name,
          credits: credits?Number(credits[0]):null,
          categoryPath: ki>=0?textOf(cells[ki]||{}):"",
          section: si>=0?textOf(cells[si]||{}):"",
          teacherName: ji>=0?textOf(cells[ji]||{}):"",
          campus: cai>=0?textOf(cells[cai]||{}):"",
          weekText: weekText,
          timeText: timeText,
          place: place,
          capacityLimit: countAt(cli),
          capacitySelected: countAt(csi),
          capacityAvailable: countAt(cvi),
          enrollStatus: ei>=0?textOf(cells[ei]||{}):"",
          meetings: parsedMeetings,
          catalogCourseId: null,
          catalogTeacherId: null
        });
      }
      if (!rows.length) continue;
      var tableMarker=String(tables[t].id||tables[t].getAttribute("name")||"");
      var tableContext=docUrl+" "+tableMarker+" "+rows.map(function(row){return row.categoryPath;}).join(" ");
      if (/S2020302|S20301|个人课表|选课结果|已选课程/i.test(tableContext)) enrolled=enrolled.concat(rows);
      else if (/公共选修|公选|通识选修/.test(tableContext)) publicElectives=publicElectives.concat(rows);
      else planned=planned.concat(rows);
    }
  });
  if (!enrolled.length && !planned.length && !publicElectives.length){
    alert("当前页没有找到课程表；请确认教务会话有效，并打开选课结果或候选课程");
    return;
  }
  var terms=optionList(roots,["xnxq","xq","term"]);
  var grades=optionList(roots,["nj","grade"]);
  var majors=optionList(roots,["zy","major"]);
  var levels=optionList(roots,["pycc","xslb","level"]);
  var captured=[];
  if (enrolled.length) captured.push("enrolled");
  if (planned.length) captured.push("planned");
  if (publicElectives.length) captured.push("public");
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
    captured: captured,
    enrolled: enrolled,
    planned: planned,
    publicElectives: publicElectives
  };
  var json=JSON.stringify(snapshot,null,2);
  if (unescape(encodeURIComponent(json)).length>2*1024*1024) {
    alert("教务快照超过 2 MB，请缩小结果页范围后重新导出");
    return;
  }
  var blob=new Blob([json],{type:"application/json"});
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
