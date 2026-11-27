export interface StoreActivityProfile {
  id: 'grocery' | 'apparel' | 'electronics' | 'cosmetics' | 'hardware';
  nameAr: string;
  subtitleAr: string;
  defaultUnits: string[];
  categories: string[];
  supportsAttributes: boolean;
  attributeLabelAr: string;
}

export const STORE_ACTIVITIES: StoreActivityProfile[] = [
  {
    id: 'grocery',
    nameAr: 'سوبر ماركت وبقالة',
    subtitleAr: 'مواد غذائية، ألبان، مشروبات، ومنظفات سريعة الدوران',
    defaultUnits: ['قطعة', 'علبة', 'كيلو', 'كرتونة', 'لتر'],
    categories: ['ألبان وأجبان', 'مواد غذائية', 'مشروبات وعصائر', 'منظفات', 'سناكس وحلويات'],
    supportsAttributes: true,
    attributeLabelAr: 'الوزن / الحجم',
  },
  {
    id: 'apparel',
    nameAr: 'ملابس وأحذية',
    subtitleAr: 'ملابس رجالي وحريمي وأطفالي وأحذية بمقاسات وألوان',
    defaultUnits: ['قطعة', 'طقم', 'زوج', 'دستة'],
    categories: ['تيشيرتات وقمصان', 'بنطلونات وجينز', 'أحذية وسنيكرز', 'عبايات وملابس حريمي', 'إكسسوارات'],
    supportsAttributes: true,
    attributeLabelAr: 'المقاس / اللون',
  },
  {
    id: 'electronics',
    nameAr: 'موبايلات وإلكترونيات',
    subtitleAr: 'هواتف، إكسسوارات أصلية، شواحن، وصيانة سريعة',
    defaultUnits: ['قطعة', 'علبة', 'طقم'],
    categories: ['هواتف ذكية', 'شواحن وكابلات', 'سماعات', 'جرابات واسكرينات', 'أجهزة ذكية'],
    supportsAttributes: true,
    attributeLabelAr: 'السعة / الضمان',
  },
  {
    id: 'cosmetics',
    nameAr: 'مستحضرات تجميل وعناية',
    subtitleAr: 'عطور، عناية بالبشرة والشعر، ومستلزمات غير دوائية',
    defaultUnits: ['عبوة', 'قطعة', 'علبة', 'مجموعة'],
    categories: ['عناية بالبشرة', 'عطور وبرفانات', 'عناية بالشعر', 'ميك أب', 'عناية شخصية'],
    supportsAttributes: true,
    attributeLabelAr: 'الحجم / الدرجة',
  },
  {
    id: 'hardware',
    nameAr: 'أدوات منزلية وقطع غيار',
    subtitleAr: 'عدد يدوية، مستلزمات كهرباء وسباكة، وأدوات مطبخ',
    defaultUnits: ['قطعة', 'متر', 'طقم', 'كيلو', 'علبة'],
    categories: ['مستلزمات كهرباء', 'سباكة ولوازمها', 'عدد يدوية', 'أدوات مطبخ', 'قطع غيار'],
    supportsAttributes: true,
    attributeLabelAr: 'المواصفة / المقاس',
  },
];
