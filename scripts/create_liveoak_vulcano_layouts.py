#!/usr/bin/env python3
from pathlib import Path
import base64, json, mimetypes

ROOT = Path('/Users/admin/Desktop/HermesRack/FRAMEWORK/visual-layout-editor')
OUT = ROOT/'examples'/'liveoak-vulcano-production-fix'
OUT.mkdir(parents=True, exist_ok=True)
BASE = Path('/Users/admin/Desktop/HermesRack/SOCIAL-MEDIA-MANAGER/Liveoakbbq')
CAMPAIGN = BASE/'campaigns/logo-correction-20260709'
PROC = CAMPAIGN/'final-production-fix-separated-logos/vulcano-serie-t-social-campaign/roby-production/assets/processed'
LIVE_LOGO = BASE/'brand-assets/liveoakbbq-logo/SoloLogoScelto-02.png'
VULCANO_WHITE = CAMPAIGN/'brand-assets/vulcano-fire/vulcano-fire-logo-white-cropped.png'

COL = {'cream':'#fff5e3','warm':'#fbf0dc','red':'#eb0029','navy':'#04000b','corten':'#bf521f','black':'#11100f','muted':'#5d5043','line':'#e5d3b9','white':'#ffffff'}
PRODUCTS = {
 'piccolo': {'title':'Serie T Piccolo','sku':'VCKT650','dim':'74 × 78 × 263 cm','peso':'210 kg','headline':'Compatto, senza rinunciare\nal fuoco vivo','sub':'Per spazi raccolti,\nterrazze ampie e piccoli\ngiardini','size':'PICCOLO','img':PROC/'piccolo_cutout.png'},
 'medio': {'title':'Serie T Medio','sku':'VCKT740','dim':'74 × 101 × 263 cm','peso':'240 kg','headline':'Il più equilibrato per molti\ngiardini','sub':'Presenza importante,\ningombro più gestibile','size':'MEDIO','img':PROC/'medio_cutout.png'},
 'grande': {'title':'Serie T Grande','sku':'VCKT860','dim':'86 × 123 × 263 cm','peso':'310 kg','headline':'Il centro della tua zona\nfuoco','sub':'Per giardini ampi e aree\nbarbecue dedicate','size':'GRANDE','img':PROC/'grande_cutout.png'},
}

def data_url(path):
    path=Path(path)
    mime=mimetypes.guess_type(path.name)[0] or 'image/png'
    return f"data:{mime};base64,"+base64.b64encode(path.read_bytes()).decode('ascii')

def text(id,name,x,y,w,h,value,size=42,weight='800',color='#111111',align='left',lh=1.1,z=10):
    return {'id':id,'type':'text','name':name,'x':x,'y':y,'w':w,'h':h,'z':z,'opacity':1,'text':value,'fontSize':size,'fontWeight':weight,'color':color,'align':align,'lineHeight':lh}

def rect(id,name,x,y,w,h,fill,radius=0,z=1,opacity=1,stroke='#000000',sw=0):
    return {'id':id,'type':'rect','name':name,'x':x,'y':y,'w':w,'h':h,'z':z,'opacity':opacity,'fill':fill,'stroke':stroke,'strokeWidth':sw,'radius':radius}

def image(id,name,x,y,w,h,path,fit='contain',z=5,opacity=1):
    return {'id':id,'type':'image','name':name,'x':x,'y':y,'w':w,'h':h,'z':z,'opacity':opacity,'src':data_url(path),'fit':fit}

def base_layers(w,h):
    return [
        rect('left_red_stripe','Stripe rosso laterale',0,0,16,h,COL['red'],0,1),
        rect('red_shape','Forma rossa prodotto',0,int(h*0.55),360,int(h*0.35),COL['red'],0,1,0.95),
        rect('vulcano_back','Box arancio logo Vulcano',760,-125,485,365,COL['corten'],95,2,0.72),
        image('liveoak_logo','Logo LiveOakBBQ',54,44,260,82,LIVE_LOGO,'contain',20),
        image('vulcano_logo','Logo Vulcano produttore',882,50,140,78,VULCANO_WHITE,'contain',20),
    ]

def sku_badge(p):
    return [rect('sku_badge','Badge SKU',54,142,128,46,COL['red'],24,12), text('sku_text','Testo SKU',66,153,100,24,p['sku'],22,'800',COL['white'],'left',1,13)]

def cta_layers():
    return [rect('cta_box','CTA box rosso',655,1090,375,126,COL['red'],28,30), text('cta_text','CTA testo centrato',690,1118,305,62,'Scopri il modello\nsu LiveOakBBQ',42,'800',COL['white'],'center',1.05,31)]

def info_panel_layers(p):
    layers=[rect('measure_panel','Box misure',675,385,355,663,COL['white'],34,18,0.92, COL['line'],2)]
    y=420
    infos=[('DIMENSIONI',p['dim'],COL['navy'],COL['white']),('PESO',p['peso'],COL['navy'],COL['white']),('MATERIALE','Acciaio alluminato 2 mm',COL['warm'],COL['black']),('INTERNO','Tavelle refrattarie 30 mm',COL['warm'],COL['black']),('BASE','Braciere incluso',COL['warm'],COL['black'])]
    for i,(lab,val,fill,color) in enumerate(infos):
        layers.append(rect(f'info_box_{i}',f'Info {lab}',704,y,296,104,fill,22,19,1,COL['line'],1))
        layers.append(text(f'info_lab_{i}',f'Label {lab}',726,y+14,230,24,lab,20,'800',COL['corten'] if fill==COL['warm'] else COL['cream'],'left',1,20))
        layers.append(text(f'info_val_{i}',f'Valore {lab}',726,y+43,238,50,val,27,'800',color,'left',1.02,20))
        y += 119
    return layers

def product_focus(key, filename):
    p=PRODUCTS[key]
    layers=base_layers(1080,1350)+sku_badge(p)
    title_size=76 if key!='medio' else 88
    layers += [
        text('title','Titolo prodotto',54,220,610,90,p['title'],title_size,'800',COL['black'],'left',1.05,12),
        text('headline','Sottotitolo rosso',56,340,560,95,p['headline'],42,'800',COL['red'],'left',1.05,12),
        image('product','Prodotto',70,585 if key=='grande' else 625,590,760 if key=='grande' else 720,p['img'],'contain',14),
    ]
    layers += info_panel_layers(p) + cta_layers()
    layout={'version':1,'app':'roby-visual-layout-editor','canvas':{'width':1080,'height':1350,'background':COL['warm']},'layers':layers}
    (OUT/filename).write_text(json.dumps(layout,indent=2,ensure_ascii=False))

def comparison():
    layers=base_layers(1080,1350)
    layers += [
        rect('badge','Badge confronto',54,138,286,46,COL['red'],24,12),
        text('badge_text','Testo badge',78,150,230,22,'CONFRONTO SERIE T',22,'800',COL['white'],'left',1,13),
        text('title','Titolo',54,210,760,165,'Grande, Medio\no Piccolo?',88,'800',COL['black'],'left',1.03,12),
        text('subtitle','Sottotitolo',58,405,810,70,'Tre misure, una stessa idea: portare il fuoco vivo\nal centro del tuo spazio outdoor.',34,'400',COL['black'],'left',1.08,12),
        rect('cta_box','CTA confronto',365,1278,350,42,COL['red'],22,20),
        text('cta_text','CTA confronto testo',365,1288,350,24,'Scegli il modello giusto',24,'800',COL['white'],'center',1,21),
    ]
    xs=[72,407,742]; keys=['piccolo','medio','grande']
    for i,(x,key) in enumerate(zip(xs,keys)):
        p=PRODUCTS[key]
        layers += [
            rect(f'label_{key}',f'Label {key}',x,560,224,42,COL['black'],20,15),
            text(f'label_text_{key}',f'Testo label {key}',x,568,224,22,p['size'],23,'800',COL['white'],'center',1,16),
            image(f'prod_{key}',f'Prodotto {key}',x-10,625,250,430,p['img'],'contain',14),
            rect(f'card_{key}',f'Card misure {key}',x-10,1040,270,215,COL['white'],26,15,0.95,COL['line'],2),
            text(f'dim_{key}',f'Misure {key}',x+8,1074,232,28,p['dim'],26,'800',COL['black'],'center',1,16),
            text(f'peso_{key}',f'Peso {key}',x+8,1118,232,28,p['peso'],26,'800',COL['red'],'center',1,16),
            text(f'sub_{key}',f'Descrizione {key}',x+8,1162,232,70,p['sub'],20,'400',COL['muted'],'center',1.08,16),
        ]
    layout={'version':1,'app':'roby-visual-layout-editor','canvas':{'width':1080,'height':1350,'background':COL['warm']},'layers':layers}
    (OUT/'02_feed_confronto_tre_misure.layout.json').write_text(json.dumps(layout,indent=2,ensure_ascii=False))

def reel_cover():
    layers=base_layers(1080,1920)
    # adapt large background shapes and logo positions for vertical
    layers[1]=rect('red_shape','Forma rossa prodotti',0,1010,490,430,COL['red'],0,1,0.95)
    layers[2]=rect('vulcano_back','Box arancio logo Vulcano',760,-125,485,365,COL['corten'],95,2,0.72)
    layers[3]=image('liveoak_logo','Logo LiveOakBBQ',66,56,310,96,LIVE_LOGO,'contain',20)
    layers[4]=image('vulcano_logo','Logo Vulcano produttore',882,50,140,78,VULCANO_WHITE,'contain',20)
    # fixed watermark in background
    layers.append(image('watermark','Watermark LiveOakBBQ fisso',110,690,860,430,LIVE_LOGO,'contain',3,0.14))
    layers += [
        text('title','Titolo reel cover',70,225,780,170,'Il giardino\ndiventa cucina',88,'800',COL['black'],'left',1.03,12),
        text('subtitle','Sottotitolo reel',75,470,890,95,'Scopri la guida LiveOakBBQ ai caminetti\nesterni Vulcano Fire Serie T',42,'800',COL['muted'],'left',1.06,12),
        image('prod_piccolo','Prodotto piccolo',80,890,285,690,PRODUCTS['piccolo']['img'],'contain',14),
        image('prod_medio','Prodotto medio',400,890,285,725,PRODUCTS['medio']['img'],'contain',14),
        image('prod_grande','Prodotto grande',720,890,285,760,PRODUCTS['grande']['img'],'contain',14),
        rect('cta_box','CTA box reel',80,1385,920,130,COL['red'],34,30),
        text('cta_text','CTA testo reel',110,1422,860,50,'Scrivici per scegliere il modello giusto',42,'800',COL['white'],'center',1,31),
        text('bottom_label','Dicitura modelli',160,1588,760,60,'Piccolo • Medio • Grande',58,'800',COL['black'],'center',1,31),
    ]
    layout={'version':1,'app':'roby-visual-layout-editor','canvas':{'width':1080,'height':1920,'background':COL['warm']},'layers':layers}
    (OUT/'reel_hero_cover_1080x1920.layout.json').write_text(json.dumps(layout,indent=2,ensure_ascii=False))

comparison()
product_focus('grande','03_feed_focus_grande.layout.json')
product_focus('medio','04_feed_focus_medio.layout.json')
product_focus('piccolo','05_feed_focus_piccolo.layout.json')
reel_cover()
index=[
 {'name':'LiveOak Vulcano — 02 confronto tre misure','path':'./examples/liveoak-vulcano-production-fix/02_feed_confronto_tre_misure.layout.json'},
 {'name':'LiveOak Vulcano — 03 focus grande','path':'./examples/liveoak-vulcano-production-fix/03_feed_focus_grande.layout.json'},
 {'name':'LiveOak Vulcano — 04 focus medio','path':'./examples/liveoak-vulcano-production-fix/04_feed_focus_medio.layout.json'},
 {'name':'LiveOak Vulcano — 05 focus piccolo','path':'./examples/liveoak-vulcano-production-fix/05_feed_focus_piccolo.layout.json'},
 {'name':'LiveOak Vulcano — reel cover','path':'./examples/liveoak-vulcano-production-fix/reel_hero_cover_1080x1920.layout.json'},
]
(ROOT/'examples'/'index.json').write_text(json.dumps(index,indent=2,ensure_ascii=False))
print(OUT)
print(ROOT/'examples'/'index.json')
