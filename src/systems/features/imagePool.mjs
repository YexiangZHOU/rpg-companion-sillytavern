/** One shared bound for concurrent native images, including scene images. */
export class ImagePool {
    constructor(limit=10){this.limit=limit;this.active=0;this.waiting=[];this.peak=0;}
    async run(work,valid=()=>true){
        await new Promise(resolve=>{this.waiting.push(resolve);this.drain();});
        try{return valid()?await work():null;}finally{this.active--;this.drain();}
    }
    drain(){while(this.active<this.limit&&this.waiting.length){this.active++;this.peak=Math.max(this.peak,this.active);this.waiting.shift()();}}
}
export const nativeImagePool=new ImagePool(10);
