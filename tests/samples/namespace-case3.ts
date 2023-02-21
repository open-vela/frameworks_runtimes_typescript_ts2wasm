let nscase3_global1 = 1;

namespace NSCase3 {
    namespace NSInner {
        function case2() {
            nscase3_global1 += 1;
        }
        case2();
    }
    function case2() {
        nscase3_global1 += 1;
    }
    case2();
}

nscase3_global1 += 1;
