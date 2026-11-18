"""One-time extraction: preserve the nine PRD queries without manually rewriting them."""
import re,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
s=(root/'PRD.md').read_text()
items=[]
for m in re.finditer(r'^##### (Q\d{2})｜([^：\n]+)：([^\n]+)\n(.*?)(?=^##### |^#### |^## 评测方式)',s,re.M|re.S):
    id,typ,title,body=m.groups()
    def field(name):
        return re.search(r'\*\*'+name+r'：\*\* ([^\n]+)',body).group(1)
    query=body.split('**Query：**',1)[1].strip().replace('\\-','-')
    category='教学设计' if id<='Q03' else ('讲解与习题' if id<='Q06' else '课件与教学资源')
    items.append(dict(id=id,title=title,subject=field('学科'),stage=field('教育阶段'),scenario=field('任务场景'),category=category,queryType=typ,query=query,background=f"{field('学科')} · {field('教育阶段')} · {field('任务场景')}",requirements=query))
assert len(items)==9
(root/'server'/'benchmark.json').write_text(json.dumps(items,ensure_ascii=False,indent=2)+'\n')
print('Extracted',len(items),'PRD queries')
