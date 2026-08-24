import { JWXT_IMPORT_HASH_PREFIX } from "./jwxt-schedule-text";

/** 在学生已打开的 jwxt 页运行：只回传课表行，不读 Cookie。 */
export function jwxtImportBookmarkletSource(origin: string): string {
  const site = origin.replace(/\/$/, "");
  return `(function(){
  var origin=${JSON.stringify(site)};
  if (!/jwxt\\.jxufe\\.edu\\.cn$/i.test(location.hostname)) {
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
        if (/CASTGC|JSESSIONID|password|cookie/i.test(name+time)) continue;
        rows.push({
          courseName:name,
          courseCode:"",
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
