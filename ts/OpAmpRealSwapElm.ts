import { OpAmpRealElm } from "./OpAmpRealElm";

// real op-amp with the + input on top: the same element as OpAmpRealElm with the swap flag set,
// like OpAmpSwapElm is for OpAmpElm (it only exists to have its own button and menu item)
export class OpAmpRealSwapElm extends OpAmpRealElm {
    constructor(xx: number, yy: number) {
        super(xx, yy);
        this.flags |= this.FLAG_SWAP;
        this.setPoints();
    }
    getDumpClass(): Function { return OpAmpRealElm; }
}
