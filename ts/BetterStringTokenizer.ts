/*
    Copyright (C) Paul Falstad and Iain Sharp

    This file is part of CircuitJS1.

    CircuitJS1 is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 2 of the License, or
    (at your option) any later version.

    CircuitJS1 is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with CircuitJS1.  If not, see <http://www.gnu.org/licenses/>.
*/

// tokenizer for SPICE lines: returns the delimiters as tokens too (except spaces and
// tabs, which are skipped), and each token in lower case (tokenPreserveCase keeps the
// original).  The delimiters can be changed in the middle of a line.

export class BetterStringTokenizer {
    delim: string;
    text: string;
    pos: number;
    tlen: number;
    token: string = "";
    tokenPreserveCase: string = "";

    constructor(text: string, delim: string) {
        this.text = text;
        this.delim = delim;
        this.pos = 0;
        this.tlen = text.length;
        this.skipSpaces();
    }

    private skipSpaces(): void {
        while (this.pos < this.tlen && (this.text.charAt(this.pos) === ' ' || this.text.charAt(this.pos) === '\t'))
            this.pos++;
    }

    nextToken(): string {
        if (this.pos === this.tlen) {
            this.token = this.tokenPreserveCase = "";
            return this.token;
        }
        let i = this.pos + 1;
        const c = this.text.charAt(this.pos);
        if (this.delim.indexOf(c) < 0) {
            while (i < this.tlen && this.delim.indexOf(this.text.charAt(i)) < 0)
                i++;
        }
        this.tokenPreserveCase = this.text.substring(this.pos, i);
        this.token = this.tokenPreserveCase.toLowerCase();
        this.pos = i;
        this.skipSpaces();
        return this.token;
    }

    nextTokenPreserveCase(): string {
        this.nextToken();
        return this.tokenPreserveCase;
    }

    setDelimiters(d: string): void {
        this.delim = d;
    }

    hasMoreTokens(): boolean {
        return this.pos < this.tlen;
    }
}
