import swaggerJsdoc from 'swagger-jsdoc';

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Batch Report API',
      version: '1.0.0',
      description:
        'API cung cấp dữ liệu thời gian hoạt động của các máy sản xuất, đọc từ file PDF report',
    },
    servers: [{ url: '/', description: 'Current server' }],
    tags: [
      { name: 'Batches', description: 'Truy vấn dữ liệu mẻ sản xuất' },
      { name: 'Machines', description: 'Truy vấn dữ liệu máy' },
      { name: 'System', description: 'Health check, tiện ích hệ thống' },
    ],
  },
  apis: ['./src/api/routes/*.ts', './dist/api/routes/*.js'],
});
