/**
 * Few-shot example kept separate from source text. It is appended to prompts
 * only; no application text is ever replaced by this content.
 */
export const CHIBI_FEW_SHOT = `示例（只示范字段与措辞，禁止把示例内容当作原文事实）：
【示例原文】建安十三年，曹操自江陵东下，遇于赤壁。
【地名抽取 JSON】
{"mentions":[{"name":"江陵","quote":"曹操自江陵东下","context":"建安十三年，曹操自江陵东下","modernHint":"今湖北荆州","category":"city"},{"name":"赤壁","quote":"遇于赤壁","context":"遇于赤壁","modernHint":"今湖北赤壁市","category":"battlefield"}]}
【态势 JSON】
{"title":"赤壁对峙","timeLabel":"建安十三年","summary":{"overview":"曹操军由江陵东下，孙刘联军在赤壁一带迎击。","keyPoints":["江陵为曹军出发点"],"uncertainty":["双方兵力未详"]},"factions":[{"id":"f1","name":"曹操军","color":"#9b2c2c"},{"id":"f2","name":"孙刘联军","color":"#2c5282"}],"places":[{"placeId":"p1","factionId":"f1","role":"出发地"},{"placeId":"p2","factionId":"f2","role":"迎击地"}],"routes":[{"id":"r1","fromPlaceId":"p1","toPlaceId":"p2","factionId":"f1","kind":"advance","label":"顺江东下","evidence":["曹操自江陵东下"]}],"controlAreas":[],"frontLines":[],"scenes":[{"title":"战前推进","summary":"曹军自江陵向赤壁推进。","placeIds":["p1","p2"],"routeIds":["r1"]}],"evidence":[]}`;
