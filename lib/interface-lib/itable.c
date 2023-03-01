#include <stdio.h>
#include <stdlib.h>
#include <memory.h>

/*
 name: field name
 flag: field type, function or property
 index: field index in shape
 */
typedef struct ItableField {
    char *name;
    int flag;
    int index;
} ItableField;

/*
 id: type id
 size: field size
 itable_field: field array
*/
typedef struct Itable {
    int id;
    int size;
    ItableField fields[0];
} Itable;

/* find field index based on prop_name*/
int find_index(Itable *table, char *prop_name) {
    for (int i = 0; i < table->size; i++) {
        if (strcmp(table->fields[i].name, prop_name) == 0) {
            return i;
        }
    }
    return -1;
}
