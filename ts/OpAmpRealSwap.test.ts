import { describe, it, expect } from "vitest";
import { OpAmpRealElm } from "./OpAmpRealElm";
import { OpAmpRealSwapElm } from "./OpAmpRealSwapElm";

describe("real op-amp with + on top", () => {
    it("is saved with the tag of the real op-amp, which other versions can read", () => {
        // (made from the prototypes: constructing one needs the app)
        const swap: any = Object.create(OpAmpRealSwapElm.prototype);
        const real: any = Object.create(OpAmpRealElm.prototype);
        expect(swap.getXmlDumpType()).toBe(real.getXmlDumpType());
    });
});
