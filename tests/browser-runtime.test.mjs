import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// Smoke test the REAL browser entry point, with a minimal DOM/canvas surface.
// Unlike syntax-only tests this catches removed HTML controls that stop game
// initialization and leave the canvas black.
test("browser entry point initializes and paints its first canvas frame",async()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const knownIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(new Set(knownIds).size,knownIds.length);
  const elements=new Map();
  class FakeElement{
    constructor(id=""){
      this.id=id;
      this.width=id==="board"?420:undefined;
      this.height=id==="board"?710:undefined;
      this.textContent="";
      this.hidden=false;
      this.disabled=false;
      this.dataset={};
      this.style={setProperty() {}};
      this.classList={add(){},remove(){},toggle(){}};
      this.children=[];
      this.listeners=new Map();
      this.offsetWidth=20;
      this.clientHeight=id==="section"?850:0;
      this.clientWidth=id==="section"?540:0;
    }
    addEventListener(name,listener){this.listeners.set(name,listener);}
    getBoundingClientRect(){
      if(this.id==="board")return {left:0,top:0,width:420,height:710};
      if(this.id==="cabinet")return {left:0,top:0,width:420,height:830};
      if(this.id==="mobile-bar")return {left:0,top:0,width:300,height:0};
      if(this.id==="launch")return {left:0,top:0,width:420,height:30};
      return {left:0,top:0,width:400,height:130};
    }
    replaceChildren(...children){this.children=[...children];}
    append(...children){this.children.push(...children);}
    setAttribute(){}
    showModal(){this.open=true;}
    close(){this.open=false;}
    getContext(){return context;}
  }
  for(const id of knownIds)elements.set(id,new FakeElement(id));
  const context={
    clears:0,paints:0,
    setTransform(){},
    clearRect(){this.clears++;},
    fillRect(){this.paints++;},
    beginPath(){},roundRect(){},fill(){},stroke(){},
    save(){},restore(){},moveTo(){},lineTo(){},
    arc(){},fillText(){},translate(){},quadraticCurveTo(){},
    createLinearGradient(){return {addColorStop(){}};},
    createRadialGradient(){return {addColorStop(){}};},
  };
  const stage=new FakeElement("section");
  const cabinet=new FakeElement("cabinet");
  const mobile=new FakeElement("mobile-bar");
  const launch=new FakeElement("launch");
  const addButtons=[1,5,10,1,5,10].map(n=>{
    const btn=new FakeElement();btn.dataset.add=String(n);return btn;
  });
  const refundButtons=[new FakeElement(),new FakeElement()];
  const lamps=[2,4,6,8,10].map(n=>{
    const node=new FakeElement();node.dataset.multLamp=String(n);return node;
  });
  const closeButtons=[new FakeElement(),new FakeElement()];
  let requested=[];
  globalThis.document={
    getElementById(id){return elements.get(id)??null;},
    querySelector(s){
      if(s===".machine-section")return stage;
      if(s===".cabinet")return cabinet;
      if(s===".mobile-playbar")return mobile;
      if(s===".launch-console")return launch;
      return null;
    },
    querySelectorAll(s){
      if(s==="[data-add]")return addButtons;
      if(s==="[data-refund]")return refundButtons;
      if(s==="[data-mult-lamp]")return lamps;
      if(s==="[data-close]")return closeButtons;
      return [];
    },
    createElement(){return new FakeElement();},
    body:{dataset:{}},
  };
  globalThis.window={
    devicePixelRatio:1,
    matchMedia(){return {matches:false};},
    addEventListener(){},
    visualViewport:{addEventListener(){}},
  };
  globalThis.localStorage={getItem(){return null;},setItem(){}};
  globalThis.getComputedStyle=node=>({
    display:node===mobile?"none":"block",rowGap:"5px",
  });
  globalThis.requestAnimationFrame=callback=>{requested.push(callback);return requested.length;};
  globalThis.confirm=()=>false;
  await import("../public/game.js");
  // The first scheduled callback fits the cabinet, the second paints.
  for(let i=0;i<6&&requested.length;i++){
    const callback=requested.shift();
    callback(performance.now()+i*17);
    if(context.paints>=2)break;
  }
  assert.ok(context.clears>=1,"Canvas must be cleared and redrawn");
  assert.ok(context.paints>=2,"Background and playing field must be rendered");
  assert.ok(requested.length>=1,"Animation loop must continue");
  assert.ok(elements.get("launchStatus").textContent.length>0,"HUD must refresh");
  assert.equal(addButtons.length,6);
  assert.equal(lamps.length,5);
});
