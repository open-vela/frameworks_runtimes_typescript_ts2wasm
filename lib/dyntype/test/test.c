#include "dyntype.h"
#include <stdlib.h>
#include <stdio.h>

void helper(int i) {
    i = 10;
}
int main(int argc, char const *argv[])
{
    dyn_ctx_t ctx = dyntype_context_init();
    if (!ctx) {
        printf("Context init fail\n");
        return 0;
    }

    // number test
    printf("\n\nnumber test\n");
    dyn_value_t num = dyntype_new_number(ctx, 2147483649.1);
    double res;;
    if (dyntype_is_number(ctx, num)) {
        dyntype_to_number(ctx, num, &res);
        printf("%lf, expect 2147483649.1\n", res);
    }
    dyntype_release(ctx, num);
    dyn_value_t num2 = dyntype_new_number(ctx, -1);
    if (dyntype_is_number(ctx, num2)) {
        dyntype_to_number(ctx, num2, &res);
        printf("%lf, expect -1.0\n", res);
    }
    dyntype_release(ctx, num2);

    // object test
    printf("\n\nobject type test\n");
    dyn_value_t obj = dyntype_new_object(ctx);
    dyn_value_t num3 = dyntype_new_number(ctx, 100);

    printf("%d, expect 1\n", dyntype_is_object(ctx, obj));
    if (dyntype_set_property(ctx, obj, "age", num3) == DYNTYPE_SUCCESS) {
        if (dyntype_is_number(ctx, num3)) {
            dyntype_to_number(ctx, num3, &res);
            printf("%lf, expect -100.000000\n", res);
        }
        dyntype_release(ctx, num3);

        printf("%d, expect 0\n", dyntype_has_property(ctx, obj, "name"));
        printf("%d, expect 1\n", dyntype_has_property(ctx, obj, "age"));

        // delete property test
        int delete_res = dyntype_delete_property(ctx, obj, "age");
        printf("%d, expect 1\n", delete_res);
        printf("%d, expect 0\n", dyntype_has_property(ctx, obj, "age"));
    }
    dyn_value_t udf = dyntype_new_undefined(ctx);
    dyntype_set_property(ctx, obj, "undefine", udf);
    dyn_value_t udf1 = dyntype_get_property(ctx, obj, "undefine");
    dyntype_release(ctx, udf1);
    dyntype_release(ctx, udf);

    // defineproperty test
    // currently not test setter/getter yet, because function defined with tag ref.
    printf("\n\ndefineproperty test\n");
    dyn_value_t desc = dyntype_new_object(ctx);
    dyn_value_t bool_ = dyntype_new_boolean(ctx, false);
    dyn_value_t value = dyntype_new_number(ctx, 42);
    dyntype_set_property(ctx, desc, "configurable", bool_);
    int def_Ref = dyntype_define_property(ctx, obj, "gender", desc);

    // because flag configurable: FALSE, it will delete failed and return FALSE
    printf("%d, expect 0\n", dyntype_delete_property(ctx, obj, "gender"));
    dyntype_release(ctx, bool_);
    dyntype_release(ctx, desc);
    dyntype_release(ctx, value);
    dyntype_release(ctx, obj);

    // bool related APIs test
    printf("\n\nbool related APIs test\n\n");
    dyn_value_t bool1 = dyntype_new_boolean(ctx, false);
    dyn_value_t bool2 = dyntype_new_boolean(ctx, true);
    printf("%d, %d, expect 1, 1\n", dyntype_is_bool(ctx, bool1), dyntype_is_bool(ctx, bool2));
    bool pres1, pres2;
    printf("%d, %d, expect 0, 0\n", dyntype_to_bool(ctx, bool1, &pres1), dyntype_to_bool(ctx, bool2, &pres2));
    printf("%d, %d, expect 0, 1\n", pres1, pres2);

    dyntype_release(ctx, bool1);
    dyntype_release(ctx, bool2);


    // string related APIs test
    printf("\n\nstring related APIs test\n");
    char* s = "123456";
    char* res1 = NULL;
    dyn_value_t str = dyntype_new_string(ctx, s);
    printf("%d, expect 1\n", dyntype_is_string(ctx, str));
    // dyntype_to_cstring() will add ref_count
    printf("%d, expect 0\n", dyntype_to_cstring(ctx, str, &res1));
    dyntype_release(ctx, str);
    printf("%s, expect 123456\n", res1);
    dyntype_release(ctx, str);

    // array test
    printf("\n\narray test\n");
    dyn_value_t array = dyntype_new_array(ctx);
    printf("%d, expect 1\n", dyntype_is_array(ctx, array));
    dyntype_release(ctx, array);

    // typeof test
    dyn_value_t num4 = dyntype_new_number(ctx, 10.0);
    printf("\n\ntypeof test\n");
    dyn_type_t type1 = dyntype_typeof(ctx, num4);
    printf("%d, expect 4\n", type1);
    dyntype_release(ctx, num4);

    dyn_value_t obj3 = dyntype_new_object(ctx);
    type1 = dyntype_typeof(ctx, obj3);
    printf("%d, expect 2\n", type1);
    dyntype_release(ctx, obj3);

    const char* s3 = "hello";
    dyn_value_t str3 = dyntype_new_string(ctx, s3);
    type1 = dyntype_typeof(ctx, str3);
    printf("%d, expect 5\n", type1);
    dyntype_release(ctx, str3);

    // dyntype_new_object_with_proto test
    printf("\n\ndyntype_new_object_with_proto test\n");

    dyn_value_t proto = dyntype_new_object(ctx);
    dyn_value_t prop3 = dyntype_new_string(ctx, "Jack");
    dyntype_set_property(ctx, proto, "name", prop3);
    dyn_value_t obj5 = dyntype_new_object_with_proto(ctx, proto);
    dyn_value_t obj6 = dyntype_new_object(ctx);

    printf("%d, except 1\n", dyntype_has_property(ctx, obj5, "name"));
    printf("%d, except 0\n", dyntype_instanceof(ctx, obj6, proto));

    dyntype_release(ctx, proto);
    dyntype_release(ctx, obj5);
    dyntype_release(ctx, obj6);
    // dyntype_release(ctx, prop3); // TODO: memory leak here

    //  dyntype_type_eq test
    printf("\n\ndyntype_type_eq test\n");
    dyn_value_t num6 = dyntype_new_number(ctx, 20);
    dyn_value_t num7 = dyntype_new_number(ctx, 21);
    dyn_value_t array6 = dyntype_new_array(ctx);

    printf("%d, except 1\n", dyntype_type_eq(ctx, num6, num7));
    printf("%d, except 0\n", dyntype_type_eq(ctx, num6, array6));
    dyntype_release(ctx, array6);

    // dyntype_set_prototype test
    printf("\n\ndyntype_set_prototype test\n");
    dyn_value_t num8 = dyntype_new_number(ctx, 12);
    dyn_value_t obj8 = dyntype_new_object(ctx);
    dyn_value_t undefined1 = dyntype_new_undefined(ctx);
    printf("%d, except 0\n", dyntype_set_prototype(ctx, num8, obj8));
    printf("%d, except -2\n", dyntype_set_prototype(ctx, undefined1, obj8));

    dyntype_release(ctx, obj8);

    // dyntype_get_prototype test
    printf("\n\ndyntype_get_prototype test\n");
    dyn_value_t obj9 = dyntype_new_object(ctx);
    dyn_value_t num9 = dyntype_new_number(ctx, 12);
    dyntype_set_property(ctx, obj9, "age", num9);
    dyn_value_t obj10 = dyntype_new_object_with_proto(ctx, obj9);
    dyn_value_t obj11 = dyntype_get_prototype(ctx, obj10);
    dyn_value_t obj12 = dyntype_new_object(ctx);
    printf("%d, except 1\n", dyntype_has_property(ctx, obj11, "age"));
    printf("%d, except 0\n", dyntype_has_property(ctx, obj12, "age"));

    dyntype_release(ctx, obj9);
    dyntype_release(ctx, obj10);
    dyntype_release(ctx, obj11);
    dyntype_release(ctx, obj12);

    // dyntype_get_own_property test
    printf("\n\ndyntype_get_own_property test\n");
    dyn_value_t obj13 = dyntype_new_object(ctx);
    dyn_value_t num10 = dyntype_new_number(ctx, 12);
    dyntype_set_property(ctx, obj13, "age", num10);
    dyn_value_t obj14 = dyntype_new_object_with_proto(ctx, obj13);
    printf("%d, except 0\n", dyntype_get_own_property(ctx, obj13, "age") == NULL);
    printf("%d, except 1\n", dyntype_get_own_property(ctx, obj14, "age") == NULL);
    dyntype_release(ctx, obj13);
    dyntype_release(ctx, obj14);

    // dyntype_is_extref & dyntype_new_extref test
    printf("\n\ndyntype_is_extref & dyntype_new_extref test\n");
    void *ptr = NULL;
    dyn_value_t ref = dyntype_new_extref(ctx, ptr, ExtObj);
    printf("%d, except 1\n", dyntype_is_extref(ctx, ref));

    // dyn_value_t dyntype_new_null test
    printf("\n\ndyn_value_t dyntype_new_null test test\n");
    dyn_value_t null0 = dyntype_new_null(ctx);
    printf("%d, except 1\n", (bool)dyntype_is_null(ctx, null0));

    dyntype_context_destroy(ctx);

    return 0;
}
