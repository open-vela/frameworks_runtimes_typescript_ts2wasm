import {
    add,
    sub as sub,
    renamed_mul as mul,
    a,
    b as b1,
    renamed_c as c,
    ns as renamed_ns,
} from './export-case1';

add(c, b1);

renamed_ns.two();

import * as other from './export-case1';
add(a, b1);

// other.add(other.a, other.b) +
// other.sub(other.b, other.renamed_c) +
// other.renamed_mul(other.renamed_c, other.a);

other.ns.two();

import theDefault from './export-case1';

theDefault.two();

import qq from './export-case2';

qq();
