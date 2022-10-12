
#include "dyntype.h"
#include <gtest/gtest.h>

class ObjectPropertyTest : public testing::Test {
  protected:
    virtual void SetUp() {
        ctx = dyntype_context_init();
    }

    virtual void TearDown() {
        dyntype_context_destroy(ctx);
    }

    dyn_ctx_t ctx;
};

TEST_F(ObjectPropertyTest, create_number_object) {
    double check_values[] = { 2147483649.1, 0, -5.48, 1111, -1, 1234.0 };

    for (int i = 0; i < sizeof(check_values) / sizeof(check_values[0]); i++) {
        double raw_number = 0;
        dyn_value_t num = dyntype_new_number(ctx, check_values[i]);
        EXPECT_NE(num, nullptr);
        EXPECT_TRUE(dyntype_is_number(ctx, num));

        dyntype_to_number(ctx, num, &raw_number);
        EXPECT_EQ(raw_number, check_values[i]);

        dyntype_release(ctx, num);
    }
}

TEST_F(ObjectPropertyTest, create_boolean_object) {
    bool check_values[] = { true, false, false, false, true };

    for (int i = 0; i < sizeof(check_values) / sizeof(check_values[0]); i++) {
        bool raw_value = 0;
        dyn_value_t boolean = dyntype_new_boolean(ctx, check_values[i]);
        EXPECT_NE(boolean, nullptr);
        EXPECT_TRUE(dyntype_is_bool(ctx, boolean));

        dyntype_to_bool(ctx, boolean, &raw_value);
        EXPECT_EQ(raw_value, check_values[i]);

        dyntype_release(ctx, boolean);
    }
}

TEST_F(ObjectPropertyTest, create_object) {
    dyn_value_t obj = dyntype_new_object(ctx);
    EXPECT_NE(obj, nullptr);
    EXPECT_TRUE(dyntype_is_object(ctx, obj));

    dyn_value_t num = dyntype_new_number(ctx, 100);
    EXPECT_NE(num, nullptr);
    EXPECT_TRUE(dyntype_is_number(ctx, num));

    EXPECT_EQ(dyntype_set_property(ctx, obj, "age", num), DYNTYPE_SUCCESS);
    EXPECT_EQ(dyntype_has_property(ctx, obj, "age"), 1);
    EXPECT_EQ(dyntype_has_property(ctx, obj, "name"), 0);

    EXPECT_EQ(dyntype_delete_property(ctx, obj, "age"), 1);
    EXPECT_EQ(dyntype_has_property(ctx, obj, "age"), 0);

    dyntype_release(ctx, obj);

    /* Currently we need to manually release the num object,
        after GC support finished, this line is not needed */
    dyntype_release(ctx, num);
}
