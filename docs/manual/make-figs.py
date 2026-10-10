# マニュアル用に、スマホ画面を1〜3枚並べて番号を付けた図(figs/)を作る。img/ の実画面から生成する。
from PIL import Image, ImageDraw, ImageFont
import os
HERE=os.path.dirname(os.path.abspath(__file__))
IMG=os.path.join(HERE,'img'); FIG=os.path.join(HERE,'figs'); os.makedirs(FIG,exist_ok=True)
FIGS={
 'F1-register':['f01-register-list','f02-register-pin','f03-home'],
 'F2-site-new':['f04-site','f05-new','f06-edit-top'],
 'F2b-join':['f30-join','f31-join-pending'],
 'F3-input':['f07-item-ok','f08-measure','f09-ng-empty'],
 'F4-ng-photo':['f10-ng-filled','f11-key-photo'],
 'F5-camera':['f12-camera','f13-camera-use'],
 'F6a-drawing':['f14-drawing-section','f15-drawing-editor','f16-drawing-pick'],
 'F6b-drawing':['f17-drawing-measure','f18-drawing-placed','f19-drawing-registered'],
 'F6c-drawing-view':['f20-drawing-view'],
 'F7-submit':['f21-confirm','f22-pin','f23-submitted'],
 'F8-fix':['f27-fix-banner','f28-fix-item'],
 'F8b-stop':['f29-stop'],
 'F9-etc':['f24-history','f25-settings','f26-outbox'],
 'F10-locked':['f32-locked'],
 'Q1-start':['q01-board','q02-review-before-claim','q03-review-claimed'],
 'Q2-input':['q04-review-item','q05-review-ng'],
 'Q3-drawing':['q06-drawing-section','q07-drawing-editor'],
 'Q4-verdict':['q08-verdict','q09-verdict-confirm','q10-after-fix'],
 'Q5-ok':['q11-pin-verdict','q12-qa-ok','q13-report-sheet'],
 'Q6-sign':['q14-prime-sign','q15-approved'],
 'Q7-join':['q16-board-join','q17-join-approve'],
 'L1-board':['l01-board','l02-roster','l03-admin'],
 'L2-users':['l04-users','l05-invite','l10-users-locked'],
 'L3-qr':['l06-qr','l07-absences'],
 'L4-joins':['l08-joins','l09-history'],
}
W=360; GAP=14
try: font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',26)
except Exception: font=ImageFont.load_default()
for name,files in FIGS.items():
    tiles=[]
    for f in files:
        im=Image.open(os.path.join(IMG,f+'.jpg')).convert('RGB')
        h=round(im.height*W/im.width); tiles.append(im.resize((W,h),Image.LANCZOS))
    H=max(t.height for t in tiles)
    canvas=Image.new('RGB',(len(tiles)*W+(len(tiles)-1)*GAP,H),(255,255,255))
    d=ImageDraw.Draw(canvas)
    for i,t in enumerate(tiles):
        x=i*(W+GAP); canvas.paste(t,(x,0)); d.rectangle([x,0,x+W-1,H-1],outline=(200,205,200),width=2)
        if len(tiles)>1:
            d.ellipse([x+8,8,x+44,44],fill=(214,36,60)); d.text((x+26,26),str(i+1),fill='white',font=font,anchor='mm')
    canvas.save(os.path.join(FIG,name+'.jpg'),quality=82)
    print(name,canvas.size)
