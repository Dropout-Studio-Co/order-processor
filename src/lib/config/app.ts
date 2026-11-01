interface AppConfig {
    name: string;
    description: string;
    url: string;
    repository: { type: string; url: string };
    author: { name: string; url: string };
    siblings: Array<{ name: string; url: string }>;
}

export const APP_CONFIG: AppConfig = {
    name: "Order Processor",
    description: "Process and format orders for multiple courier services",
    url: "https://order-processor.dropoutstudio.co",
    repository: {
        type: "git",
        url: "https://github.com/Dropout-Studio-Co/order-processor"
    },
    author: {
        name: "Dropout Studio",
        url: "https://dropoutstudio.co"
    },
    siblings: [
        {
            name: "Invoice Generator",
            url: "https://invoice-generator.dropoutstudio.co"
        }
    ]
};
