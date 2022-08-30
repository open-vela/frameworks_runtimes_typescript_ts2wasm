const obj1 = {
    a: 1,
    sum: function () {
        return this.a + this.b;
    },
};

const obj2 = {
    b: 2,
};

Object.setPrototypeOf(obj2, obj1);
